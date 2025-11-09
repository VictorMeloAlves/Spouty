import express, { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import axios from 'axios';

// --- INICIALIZAÇÃO DO FIREBASE ADMIN ---
const serviceAccountPath = '/etc/secrets/firebase-credentials.json';
try {
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin SDK inicializado com SUCESSO!");
  } else {
      console.error("ERRO CRÍTICO: Arquivo de credenciais do Firebase NÃO encontrado.");
  }
} catch (error: any) {
  console.error("ERRO CRÍTICO ao inicializar o Firebase Admin:", error);
}
const db = admin.firestore();
// -----------------------------------------

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
const WEATHER_API_KEY = process.env.OPENWEATHER_API_KEY; // API do Clima

// =================================================================
//          *** INTERFACES DE TIPO ***
// =================================================================
// Define o formato dos nossos parâmetros de dificuldade
type Difficulty = 'FACIL' | 'MEDIO' | 'DIFICIL';

// Define o formato da nossa configuração no Firestore
interface DeviceConfig {
  difficulty: Difficulty;
  location?: {
    lat: number;
    lon: number;
  };
}

// Define o formato da resposta que esperamos da API de clima
interface WeatherData {
  weather: { main: string; description: string }[];
  main: { temp: number };
  sys: { sunrise: number; sunset: number };
  dt: number;
}

// =================================================================
//          *** PERFIS DE DIFICULDADE ***
// =================================================================
// Definimos os limites para cada nível, baseados nas suas anotações
const difficultyParams: Record<Difficulty, {
  UMIDADE_BAIXA: number;
  UMIDADE_ALTA: number;
  LUZ_BAIXA: number;
  QUOTA_UV_DIARIA: number;
}> = {
  FACIL: {
    UMIDADE_BAIXA: 0.15,
    UMIDADE_ALTA: 0.5,
    LUZ_BAIXA: 30,
    QUOTA_UV_DIARIA: 1
  },
  MEDIO: {
    UMIDADE_BAIXA: 0.3,
    UMIDADE_ALTA: 0.7,
    LUZ_BAIXA: 50,
    QUOTA_UV_DIARIA: 2
  },
  DIFICIL: {
    UMIDADE_BAIXA: 0.5,
    UMIDADE_ALTA: 0.85,
    LUZ_BAIXA: 100,
    QUOTA_UV_DIARIA: 4
  }
};

// =================================================================
//          *** FUNÇÃO DE CHAMADA DE CLIMA ***
// =================================================================
async function fetchWeather(lat: number, lon: number): Promise<{ isRaining: boolean, isNight: boolean, temp: number }> {
  if (!WEATHER_API_KEY) {
    console.error("ERRO: Chave da API OpenWeatherMap não configurada.");
    return { isRaining: false, isNight: true, temp: 0 };
  }
  
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric&lang=pt_br`;

  try {
    // <-- CORREÇÃO 2: Tipar a resposta do axios com nossa Interface
    const response = await axios.get<WeatherData>(url);
    const data = response.data; // Agora 'data' é do tipo WeatherData

    const weatherMain = data.weather[0].main;
    const isRaining = (weatherMain === "Rain" || weatherMain === "Drizzle" || weatherMain === "Thunderstorm");

    const currentTime = data.dt;
    const sunrise = data.sys.sunrise;
    const sunset = data.sys.sunset;
    const isNight = (currentTime < sunrise || currentTime > sunset);

    console.log(`Clima verificado: ${data.weather[0].description}, Noite: ${isNight}`);
    return { isRaining, isNight, temp: data.main.temp };

  } catch (error: any) { // <-- CORREÇÃO 1: Tipar o erro como 'any'
    console.error("Erro ao buscar dados do clima:", error.message || error);
    return { isRaining: false, isNight: true, temp: 0 };
  }
}

// --- ENDPOINTS DE CONTROLE DO LED ---
app.post('/api/led', async (req: Request, res: Response) => {
  const { state } = req.body;
  if (state === 'on' || state === 'off') {
    // merge: true para não apagar outros dados do documento
    await db.collection('devices').doc('vaso_01').set({ ledState: state }, { merge: true });
    console.log(`Comando '${state}' armazenado no Firestore.`);
    res.status(200).json({ message: `Comando '${state}' armazenado com sucesso.` });
  } else {
    res.status(400).json({ message: "Estado inválido. Use 'on' ou 'off'." });
  }
});

app.get('/api/led/status', async (req: Request, res: Response) => {
  const doc = await db.collection('devices').doc('vaso_01').get();
  if (!doc.exists) {
    res.status(404).json({ message: "Dispositivo não encontrado."});
  } else {
    const state = doc.data()?.ledState || 'off';
    console.log(`Estado do LED lido do Firestore: ${state}`);
    res.status(200).json({ state });
  }
});

// =================================================================
//          *** O "CÉREBRO" ATUALIZADO DO SPOUTY ***
// =================================================================
async function calculatePlantStatus(
  sensors: any, 
  config: DeviceConfig, // <-- CORREÇÃO 3: Usar nossa interface de Config
  uvQuotaMet: boolean = false
): Promise<string> {
    
    // <-- CORREÇÃO 3: Agora o TypeScript sabe que config.difficulty é do tipo Difficulty
    const params = difficultyParams[config.difficulty];

    // O resto da sua lógica de status (SLEEPING, THIRSTY, etc.)
    if (sensors.luminosity < params.LUZ_BAIXA) {
        return "SLEEPING";
    }
    if (sensors.soilMoisture < params.UMIDADE_BAIXA) {
        return "THIRSTY";
    }
    if (sensors.soilMoisture > params.UMIDADE_ALTA) {
        return "OVERWATERED";
    }
    if (!uvQuotaMet) {
        if (!config.location) {
            return "SAD_NEEDS_SUN"; 
        }
        const weather = await fetchWeather(config.location.lat, config.location.lon);
        
        if (weather.isNight || weather.isRaining) {
            return "SAD_NEEDS_SUN";
        } else {
            return "NEEDS_SUN_NOW";
        }
    }
    return "HAPPY";
}

// =================================================================
//                      *** ENDPOINTS DA API ***
// =================================================================

// --- ENDPOINT PARA O APP SALVAR A LOCALIZAÇÃO ---
app.post('/api/setlocation', async (req: Request, res: Response) => {
  const { lat, lon } = req.body;
  if (lat === undefined || lon === undefined) {
    return res.status(400).json({ message: "Coordenadas (lat, lon) ausentes." });
  }
  
  try {
    const configUpdate: Partial<DeviceConfig> = { location: { lat, lon } };
    await db.collection('devices').doc('vaso_01').set({ config: configUpdate }, { merge: true });
    res.status(200).json({ message: "Localização salva com sucesso." });
  } catch (error: any) { // <-- CORREÇÃO 1: Tipar o erro
    res.status(500).json({ message: "Erro ao salvar localização." });
  }
});

// --- ENDPOINT PARA O APP SALVAR A DIFICULDADE ---
app.post('/api/setdifficulty', async (req: Request, res: Response) => {
  const { difficulty } = req.body;
  if (!difficulty || !difficultyParams[difficulty as Difficulty]) {
    return res.status(400).json({ message: "Dificuldade inválida." });
  }
  
  try {
    const configUpdate: Partial<DeviceConfig> = { difficulty: difficulty as Difficulty };
    await db.collection('devices').doc('vaso_01').set({ config: configUpdate }, { merge: true });
    res.status(200).json({ message: `Dificuldade salva como: ${difficulty}` });
  } catch (error: any) { // <-- CORREÇÃO 1: Tipar o erro
    res.status(500).json({ message: "Erro ao salvar dificuldade." });
  }
});



// --- ENDPOINT PARA O ESP32 ENVIAR DADOS DOS SENSORES (ATUALIZADO) ---
app.post('/api/sensordata', async (req: Request, res: Response) => {
  const { luminosity, soilMoisture, uvLevel } = req.body;
  if (luminosity === undefined || soilMoisture === undefined || uvLevel === undefined) {
    return res.status(400).json({ message: "Dados incompletos." });
  }

  try {
    const doc = await db.collection('devices').doc('vaso_01').get();
    
    // <-- CORREÇÃO 3: Usar 'as' para garantir o tipo
    let config = doc.data()?.config as DeviceConfig | undefined;

    // Define um padrão se a configuração não existir
    if (!config || !config.difficulty) {
      config = { difficulty: 'MEDIO' };
    }

    const newStatus = await calculatePlantStatus({ luminosity, soilMoisture, uvLevel }, config);

    const dataToSave = {
      sensors: { luminosity, soilMoisture, uvLevel },
      status: {
        calculatedStatus: newStatus,
        lastUpdate: admin.firestore.FieldValue.serverTimestamp()
      }
    };
    await db.collection('devices').doc('vaso_01').set(dataToSave, { merge: true });
    
    console.log(`Dados salvos. Status: ${newStatus}`);
    res.status(200).json({ message: "Dados recebidos com sucesso." });

  } catch (error: any) { // <-- CORREÇÃO 1: Tipar o erro
    console.error("Erro no endpoint /sensordata:", error);
    res.status(500).json({ message: "Erro interno." });
  }
});

// ENDPOINT PARA O ESP32 (E APP) CONTROLAR O LED (Tipado)
app.get('/api/led/status', async (req: Request, res: Response) => { 
  try {
    const doc = await db.collection('devices').doc('vaso_01').get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Dispositivo não encontrado."});
    }
    const state = doc.data()?.ledState || 'off';
    res.status(200).json({ state });
  } catch(error: any) {
    res.status(500).json({ message: "Erro ao buscar estado do LED." });
  }
});

app.post('/api/led', async (req: Request, res: Response) => { 
  try {
    const { state } = req.body;
    if (state === 'on' || state === 'off') {
      await db.collection('devices').doc('vaso_01').set({ ledState: state }, { merge: true });
      res.status(200).json({ message: `Comando '${state}' armazenado com sucesso.` });
    } else {
      res.status(400).json({ message: "Estado inválido. Use 'on' ou 'off'." });
    }
  } catch(error: any) {
    res.status(500).json({ message: "Erro ao definir estado do LED." });
  }
});

// --- INICIA O SERVIDOR ---
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});