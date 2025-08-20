import express, { Request, Response } from 'express';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// =================================================================
//                     *** MUDANÇA IMPORTANTE ***
// Vamos criar uma variável para guardar o estado desejado do LED.
// Para um projeto real, isso estaria em um banco de dados.
let ledState: 'on' | 'off' = 'off'; // Começa como 'off' por padrão
// =================================================================

// MODIFICADO: Este endpoint agora DEFINE qual deve ser o estado do LED.
// O app ou o Thunder Client usarão este endpoint para enviar comandos.
app.post('/api/led', (req: Request, res: Response) => {
  const { state } = req.body;

  if (state === 'on' || state === 'off') {
    ledState = state; // Armazena o novo comando na nossa variável
    console.log(`Comando recebido e armazenado: ${ledState}`);
    res.status(200).json({ message: `Comando '${ledState}' armazenado com sucesso.` });
  } else {
    res.status(400).json({ message: "Estado inválido. Use 'on' ou 'off'." });
  }
});

// NOVO: Este endpoint é para o ESP32 PERGUNTAR qual o estado.
// O ESP32 vai chamar este endpoint a cada 10 segundos.
app.get('/api/led/status', (req: Request, res: Response) => {
  console.log(`ESP32 perguntou pelo estado. Respondendo com: ${ledState}`);
  res.status(200).json({ state: ledState });
});


app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});