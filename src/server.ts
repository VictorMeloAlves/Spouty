import express, { Request, Response } from 'express';

const app = express();
// A porta que o Render.com vai usar é passada pela variável de ambiente PORT
const port = process.env.PORT || 3000;

// Middleware para que o Express entenda requisições com corpo em JSON
app.use(express.json());

// Nosso primeiro endpoint. Ele "escuta" em /api/led por requisições do tipo POST
app.post('/api/led', (req: Request, res: Response) => {
  // req.body contém os dados enviados pelo ESP32 ou pelo App
  const { state } = req.body;

  // Por enquanto, apenas exibimos no console do servidor o que recebemos
  console.log(`Comando para o LED recebido: ${state}`);

  // Enviamos uma resposta de volta para quem chamou
  res.status(200).json({ message: `Comando '${state}' recebido com sucesso.` });
});

// Inicia o servidor e o faz "escutar" na porta definida
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});