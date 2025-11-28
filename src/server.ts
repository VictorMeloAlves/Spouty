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
const WEATHER_API_KEY = process.env.OPENWEATHER_API_KEY; // API do clima

// =================================================================
//          *** INTERFACES DE TIPO ***
// =================================================================
// Define o formato dos parametros de dificuldade
type Difficulty = 'FACIL' | 'MEDIO' | 'DIFICIL';

// Define o formato da configuração no Firestore
interface DeviceConfig {
  difficulty: Difficulty;
  location?: {
    lat: number;
    lon: number;
  };
}

// Define o formato da resposta da API de clima
interface WeatherData {
  weather: { main: string; description: string }[];
  main: { temp: number };
  sys: { sunrise: number; sunset: number };
  dt: number;
}

// =================================================================
//          *** PERFIS DE DIFICULDADE ***
// =================================================================

const difficultyParams: Record<Difficulty, {
  UMIDADE_BAIXA: number;
  UMIDADE_ALTA: number;
  LUZ_BAIXA: number;
  QUOTA_UV_DIARIA: number;
}> = {
  FACIL: {
    UMIDADE_BAIXA: 0.15,
    UMIDADE_ALTA: 0.5,
    LUZ_BAIXA: 2,
    QUOTA_UV_DIARIA: 1
  },
  MEDIO: {
    UMIDADE_BAIXA: 0.3,
    UMIDADE_ALTA: 0.7,
    LUZ_BAIXA: 2,
    QUOTA_UV_DIARIA: 2
  },
  DIFICIL: {
    UMIDADE_BAIXA: 0.5,
    UMIDADE_ALTA: 0.85,
    LUZ_BAIXA: 2,
    QUOTA_UV_DIARIA: 4
  }
};

// =================================================================
//          *** FUNÇÃO DE CHAMADA DE CLIMA ***
// =================================================================
async function fetchWeather(lat: number, lon: number): Promise<{ 
  condition: string, 
  description: string, 
  temp: number, 
  isNight: boolean 
}> {
  if (!WEATHER_API_KEY) {
    return { condition: 'Unknown', description: '--', temp: 0, isNight: false };
  }
  
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric&lang=pt_br`;

  try {
    const response = await axios.get<WeatherData>(url);
    const data = response.data;

    const currentTime = data.dt;
    const sunrise = data.sys.sunrise;
    const sunset = data.sys.sunset;
    const isNight = (currentTime < sunrise || currentTime > sunset);

    return { 
      condition: data.weather[0].main, // Ex: "Rain", "Clear"
      description: data.weather[0].description, // Ex: "chuva leve"
      temp: data.main.temp,
      isNight: isNight
    };

  } catch (error: any) {
    console.error("Erro ao buscar clima:", error.message);
    return { condition: 'Error', description: 'Erro na API', temp: 0, isNight: false };
  }
}

// --- ENDPOINTS DE CONTROLE DO LED ---
app.post('/api/led', async (req: Request, res: Response) => {
  const { state } = req.body;
  if (state === 'on' || state === 'off') {
    await db.collection('devices').doc('vaso_01').set({ ledState: state }, { merge: true });
    console.log(`Comando '${state}' armazenado no Firestore.`);
    res.status(200).json({ message: `Comando '${state}' armazenado com sucesso.` });
  } else {
    res.status(400).json({ message: "Estado inválido. Use 'on' ou 'off'." });
  }
});

app.get('/api/led/status', async (req: Request, res: Response) => { 
  try {
    const doc = await db.collection('devices').doc('vaso_01').get();
    
    if (!doc.exists) {
      return res.status(404).json({ 
        state: 'off', 
        plantStatus: 'CARREGANDO' 
      });
    }
    const data = doc.data();
    
    const ledState = data?.ledState || 'off';
    
    const plantStatus = data?.status?.calculatedStatus || 'HAPPY'; // Padrão

    console.log(`ESP32 pediu status. Enviando: LED=${ledState}, Status=${plantStatus}`);

    res.status(200).json({ 
      state: ledState, 
      plantStatus: plantStatus 
    });

  } catch(error: any) {
    console.error("Erro ao buscar estado completo:", error);
    res.status(500).json({ message: "Erro ao buscar estado." });
  }
});

// =================================================================
//          *** O "CÉREBRO" DO SPOUTY ***
// =================================================================
async function calculatePlantStatus(
  sensors: any, 
  config: DeviceConfig,
  uvQuotaMet: boolean = false
): Promise<string> {
    
    const params = difficultyParams[config.difficulty];

    if (sensors.luminosity < params.LUZ_BAIXA) return "SLEEPING";
    if (sensors.soilMoisture < params.UMIDADE_BAIXA) return "THIRSTY";
    if (sensors.soilMoisture > params.UMIDADE_ALTA) return "OVERWATERED";

    if (!uvQuotaMet) {
        if (!config.location) return "SAD_NEEDS_SUN"; 
        
        const weather = await fetchWeather(config.location.lat, config.location.lon);
        
        const isRaining = ['Rain', 'Drizzle', 'Thunderstorm'].includes(weather.condition);

        if (weather.isNight || isRaining) {
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
  } catch (error: any) {
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
  } catch (error: any) {
    res.status(500).json({ message: "Erro ao salvar dificuldade." });
  }
});



// --- ENDPOINT PARA O ESP32 ENVIAR DADOS DOS SENSORES ---
app.post('/api/sensordata', async (req: Request, res: Response) => {
  const { luminosity, soilMoisture, uvLevel } = req.body;
  if (luminosity === undefined || soilMoisture === undefined || uvLevel === undefined) {
    return res.status(400).json({ message: "Dados incompletos." });
  }

  try {
    const doc = await db.collection('devices').doc('vaso_01').get();
    
    let config = doc.data()?.config as DeviceConfig | undefined;

    if (!config || !config.difficulty) { // Define como padrão caso não exista
      config = { difficulty: 'MEDIO' };
    }

    let weatherInfo = { condition: 'Unknown', description: 'Sem dados', temp: 0, isNight: false };
    
    if (config && config.location) {
       weatherInfo = await fetchWeather(config.location.lat, config.location.lon);
    }

    const newStatus = await calculatePlantStatus({ luminosity, soilMoisture, uvLevel }, config);

    const dataToSave = {
      sensors: { luminosity, soilMoisture, uvLevel },
      weather: weatherInfo,
      status: {
        calculatedStatus: newStatus,
        lastUpdate: admin.firestore.FieldValue.serverTimestamp()
      }
    };
    await db.collection('devices').doc('vaso_01').set(dataToSave, { merge: true });
    
    console.log(`Dados salvos. Status: ${newStatus}`);
    res.status(200).json({ message: "Dados recebidos com sucesso." });

  } catch (error: any) {
    console.error("Erro no endpoint /sensordata:", error);
    res.status(500).json({ message: "Erro interno." });
  }
});

// --- INICIA O SERVIDOR ---
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});