# Projeto Spouty - Backend (API)

Este repositório contém o código-fonte do servidor backend para o projeto de vaso interativo "Spouty", desenvolvido como parte do meu Projeto Final de Curso (PFC).

## 📜 Descrição

A API atua como o cérebro do sistema, gerenciando a comunicação entre o dispositivo de hardware (ESP32), o banco de dados e o aplicativo móvel. Suas responsabilidades incluem receber dados dos sensores, armazená-los no banco de dados e fornecer endpoints para controle do dispositivo.

## 🚀 Tecnologias Utilizadas

- **Linguagem:** TypeScript
- **Ambiente:** Node.js
- **Framework:** Express
- **Banco de Dados:** Google Firestore (através do Firebase Admin SDK)
- **Hospedagem:** Render.com

## ⚙️ Como Rodar Localmente

1.  Clone este repositório.
2.  Execute `npm install` para instalar todas as dependências.
3.  É necessário configurar um arquivo de credenciais do Firebase (`firebase-credentials.json`) para se conectar ao banco de dados.
4.  Execute `npm run dev` para iniciar o servidor em modo de desenvolvimento.