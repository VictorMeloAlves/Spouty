import express, { Request, Response } from 'express';

console.log("--- INICIANDO SERVIDOR DE TESTE DE FUMAÇA (v2) ---");

const app = express();
const port = process.env.PORT || 10000; // Usando a porta do Render diretamente

// Endpoint de teste na raiz
app.get('/', (req: Request, res: Response) => {
  console.log("Endpoint raiz '/' foi chamado!");
  res.status(200).send("Servidor de teste está no ar!");
});

// Nosso endpoint problemático, agora com uma resposta fixa
app.get('/api/led/status', (req: Request, res: Response) => {
  console.log("Endpoint de teste '/api/led/status' foi chamado!");
  res.status(200).json({ status_do_teste: "sucesso" });
});

app.listen(port, () => {
  console.log(`🚀 Servidor de TESTE rodando na porta ${port}`);
});