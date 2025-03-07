const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');

// URL fixe pour OpenRouter (chat completions)
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

// Configuration LINE à partir des variables d'environnement
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};
const client = new line.Client(config);

// Configuration des 3 APIs potentielles (uniquement la clé et le modèle)
const APIS = {
  GPT4O_MINI: {
    key: process.env.GPT4O_MINI_API_KEY,
    model: 'openai/gpt-4o-mini'
  },
  GEMINI_2_FLASH: {
    key: process.env.GEMINI_2_FLASH_API_KEY,
    model: 'google/gemini-2.0-flash-001'
  },
  GEMINI_1_5: {
    key: process.env.GEMINI_1_5_API_KEY,
    model: 'google/gemini-flash-1.5-8b'
  }
};

// Choix des APIs à utiliser pour chaque usage
// Messages normaux => Gemini 2 Flash
const AUTO_API = APIS.GEMINI_1_5;
// Commande /q => GPT-4o-mini
const QUESTION_API = APIS.GPT4O_MINI;

// Middleware pour parser les requêtes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route racine pour répondre aux pings (ex. UptimeRobot)
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

// Fonction générique pour traiter un prompt via l'API choisie
async function processWithAPI(apiConfig, prompt) {
  try {
    console.log('Prompt envoyé à l’API:', prompt);

    // Préparation du corps de la requête
    const requestBody = {
      model: apiConfig.model,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 300
    };

    // Si on utilise un modèle Gemini, on fixe temperature = 0 (limite la créativité)
    if (
      apiConfig.model === 'google/gemini-2.0-flash-001' ||
      apiConfig.model === 'google/gemini-flash-1.5-8b'
    ) {
      requestBody.temperature = 0;
    }

    // Appel à l'API OpenRouter
    const response = await axios.post(
      OPENROUTER_API_URL,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${apiConfig.key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-line-bot.example.com', // Optionnel
          'X-Title': 'Line Bot' // Optionnel
        }
      }
    );

    let reply = response.data.choices[0].message.content.trim();

    // Suppression du premier et dernier caractère si la réponse est encadrée par "" ou 「」
    if (
      (reply.startsWith('"') && reply.endsWith('"')) ||
      (reply.startsWith('「') && reply.endsWith('」'))
    ) {
      reply = reply.substring(1, reply.length - 1).trim();
    }

    console.log('Réponse de l’API:', reply);
    return reply;
  } catch (error) {
    const errorMessage = error.response
      ? error.response.data.message || error.response.data.error
      : error.message;
    console.error('Erreur API:', errorMessage);
    return 'Erreur de traitement';
  }
}

// Gestionnaire d'événements LINE
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const message = event.message.text;
  console.log('Message reçu de LINE:', message);

  // Cas sans commande => réécriture/traduction automatique (Gemini 2)
  if (!message.startsWith('/')) {
    const isJapanese = isMostlyJapanese(message);
    const prompt = isJapanese
      ? `Adapt this "${message}" in English without adding anything else`
      : `Adapt this "${message}" in Japanese without adding anything else`;
    const reply = await processWithAPI(AUTO_API, prompt);
    return client.replyMessage(event.replyToken, { type: 'text', text: reply });
  }

  // Commande /q => répondre à une question (GPT-4o-mini)
  if (message.startsWith('/q')) {
    const question = message.slice(3).trim();
    const prompt = `Answer this: "${question}". Respond only with the answer and nothing else.`;
    const reply = await processWithAPI(QUESTION_API, prompt);
    return client.replyMessage(event.replyToken, { type: 'text', text: reply });
  }
}

// Démarrer le serveur
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bot démarré sur le port ${port}`);
});
