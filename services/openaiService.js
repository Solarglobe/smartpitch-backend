// D:\smartpitch\backend\services\openaiService.js

const OpenAI = require("openai");

// On lit la clé d'API depuis .env
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Fonction test : envoie un prompt simple à ChatGPT.
 * Si aucune clé n'est définie, renvoie une réponse "mock".
 */
async function testChatGPT(prompt) {
  // Si pas de clé définie → mock pour éviter erreur
  if (!process.env.OPENAI_API_KEY) {
    console.log("⚠️ Aucune clé OpenAI définie — mock activé");
    return { mock: true, reply: "Simulation locale : aucun appel OpenAI effectué." };
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // modèle rapide pour test
      messages: [
        { role: "system", content: "Tu es SmartPitch Solarglobe, assistant de calcul solaire." },
        { role: "user", content: prompt },
      ],
    });

    return response.choices[0].message;
  } catch (err) {
    console.error("❌ Erreur OpenAI :", err.message);
    return { error: true, message: err.message };
  }
}

module.exports = { testChatGPT };
