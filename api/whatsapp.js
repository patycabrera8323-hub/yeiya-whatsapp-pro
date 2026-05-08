const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// Configuración de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const SYSTEM_PROMPT = `
Eres Yeiya, la asistente virtual premium y exclusiva de SEARMO. 
Tu tono es cordial, sumamente educado y elegante. 

Lista de Servicios y Precios (MXN):
- Páginas Web: $800 – $6,000
- Bots de IA: $2,000 – $12,000
- Automatización de procesos: $1,000 – $10,000
- Apps de Delivery: $5,000 – $12,000

Instrucciones:
1. REGLA DE ORO: TUS RESPUESTAS DEBEN SER CORTAS (Máximo 2 párrafos).
2. Si el cliente quiere cotizar, pide su nombre y qué servicio le interesa.
3. Despídete siempre con elegancia ("Que pase un excelente día", "Hasta pronto").
`;

module.exports = async function handler(req, res) {
  // 1. Verificación para Meta (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      console.log('Webhook Verificado');
      return res.status(200).send(challenge);
    } else {
      return res.status(403).end();
    }
  }

  // 2. Procesamiento de Mensajes (POST)
  if (req.method === 'POST') {
    try {
      const entry = req.body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      if (message && message.type === 'text') {
        const phone = message.from;
        const text = message.text.body;
        const profileName = value?.contacts?.[0]?.profile?.name || 'Cliente';

        // --- LÓGICA DE IA (Gemini) ---
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
          model: "gemini-1.5-flash",
          systemInstruction: SYSTEM_PROMPT,
        });

        // Generar respuesta
        const result = await model.generateContent(text);
        const replyText = result.response.text();

        // --- GUARDAR EN SUPABASE ---
        const { error: dbError } = await supabase.from('leads').upsert({
          phone: phone,
          name: profileName,
          last_message: text,
          last_reply: replyText,
          updated_at: new Date()
        }, { onConflict: 'phone' });

        if (dbError) console.error('Error Supabase:', dbError);

        // --- ENVIAR RESPUESTA POR WHATSAPP ---
        await axios.post(
          `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: phone,
            type: "text",
            text: { body: replyText }
          },
          {
            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
          }
        );
      }

      return res.status(200).json({ status: 'success' });
    } catch (error) {
      console.error('Error General:', error.response?.data || error.message);
      return res.status(500).json({ error: 'Internal Error' });
    }
  }

  res.status(405).end();
};
