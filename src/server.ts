import express, { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import * as fs from 'fs';

// --- INICIALIZAÇÃO DO FIREBASE ADMIN ---
const serviceAccountPath = '/etc/secrets/firebase-credentials.json';
if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} else {
    console.warn("Arquivo de credenciais do Firebase não encontrado. Rodando em modo local/sem DB.");
}
const db = admin.firestore();
// -----------------------------------------

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

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
//          *** ENDPOINT PARA DADOS DOS SENSORES ***
// =================================================================
app.post('/api/sensordata', async (req: Request, res: Response) => {
  // 1. Pega os dados enviados pelo ESP32
  const { luminosity, soilMoisture, uvLevel } = req.body;

  // 2. Validação simples dos dados
  if (luminosity === undefined || soilMoisture === undefined || uvLevel === undefined) {
    return res.status(400).json({ message: "Dados incompletos. Envie luminosity, soilMoisture e uvLevel." });
  }

  // 3. Cria um objeto com os novos dados
  const sensorData = {
    sensors: {
      luminosity: luminosity,
      soilMoisture: soilMoisture,
      uvLevel: uvLevel,
    },
    lastUpdate: admin.firestore.FieldValue.serverTimestamp() // Adiciona um carimbo de data/hora
  };

  try {
    // 4. Salva os dados no Firestore, no mesmo documento do dispositivo
    //    { merge: true } para adicionar/atualizar estes campos sem apagar os existentes (como o ledState)
    await db.collection('devices').doc('vaso_01').set(sensorData, { merge: true });
    console.log(`Dados dos sensores recebidos e armazenados:`, sensorData.sensors);
    res.status(200).json({ message: "Dados recebidos com sucesso." });
  } catch (error) {
    console.error("Erro ao salvar dados no Firestore:", error);
    res.status(500).json({ message: "Erro interno ao salvar os dados." });
  }
});

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});

// Teste deploy