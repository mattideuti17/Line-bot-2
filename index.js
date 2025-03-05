const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');

// Fonction pour détecter si un message est majoritairement en japonais (au moins 30 %)
function isMostlyJapanese(message) {
  if (!message || typeof message !== 'string') return false;
  const japaneseChars = message.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || [];
  const totalChars = message.length;
  if (totalChars === 0) return false;
  const japanesePercentage = (japaneseChars.length / totalChars) * 100;
  return japanesePercentage >= 30;
}

const app = express();

// Configuration LINE à partir des Secrets
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};
const client = new line.Client(config);

// Configuration OpenRouter (GPT-4o Mini)
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Middleware pour parser les requêtes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route racine pour répondre aux pings (par exemple, UptimeRobot)
app.get('/', (req, res) => res.sendStatus(200));

// Route Webhook LINE
app.post('/webhook', (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.sendStatus(200))
    .catch((err) => {
      console.error(err);
      res.sendStatus(500);
    });
});

// Fonction de traitement avec GPT-4o Mini via OpenRouter
async function processWithQwen(prompt) {
  try {
    console.log('Prompt envoyé à GPT-4o Mini:', prompt); // Débogage
    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 300 // Gardé à 300 pour permettre des réponses précises
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-line-bot.example.com', // Optionnel
          'X-Title': 'Line Qwen Bot' // Optionnel
        }
      }
    );
    const reply = response.data.choices[0].message.content.trim();
    console.log('Réponse de GPT-4o Mini:', reply); // Débogage
    return reply;
  } catch (error) {
    const errorMessage = error.response ? error.response.data.message || error.response.data.error : error.message;
    console.error('Erreur OpenRouter:', errorMessage);
    return 'Erreur de traitement';
  }
}

// Gestion des événements LINE
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const message = event.message.text;
  console.log('Message reçu de LINE:', message); // Débogage

  // Réécriture automatique (sans commande)
  if (!message.startsWith('/')) {
    const isJapanese = isMostlyJapanese(message);
    const prompt = isJapanese
      ? `rewrite this "${message}" in english, without adding anything else`
      : `rewrite this "${message}" in japonais, without adding anything else`;
    const reply = await processWithQwen(prompt);
    return client.replyMessage(event.replyToken, { type: 'text', text: reply });
  }

  // Commande /q : Réponse à une question
  if (message.startsWith('/q')) {
    const question = message.slice(3).trim();
    const prompt = `do this: "${question}". Respond only with the answer and without "`;
    const reply = await processWithQwen(prompt);
    return client.replyMessage(event.replyToken, { type: 'text', text: reply });
  }
}

// Démarrer le serveur
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bot démarré sur le port ${port}`);
});
