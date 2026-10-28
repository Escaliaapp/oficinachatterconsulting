/** Local deterministic guardrail for the labelled demo. Production needs provider + human review. */
export type ContentSurface = 'chat' | 'proposal' | 'advertisement' | 'report';
export type ModerationResult = { approved: boolean; category?: string; reason?: string };

const rules: ReadonlyArray<{ pattern: RegExp; category: string; reason: string }> = [
  { pattern: /(?:pornograf|pornograph|(?:sexo|sexual) expl[ií]cit[oa]|explicit sex|desnud[oa]s?|naked|nudes?\b|violaci[oó]n sexual|sexual assault)/i, category: 'sexual', reason: 'No admitimos contenido sexual explícito.' },
  { pattern: /(?:sexual.{0,24}(?:menor|niñ|child)|(?:menor|niñ|child).{0,24}sexual|child porn|csam|lolicon)/i, category: 'child_safety', reason: 'Esta propuesta infringe las normas de protección de menores.' },
  { pattern: /(?:matar a (?:todos|los|las)|kill all|exterminar|heil hitler|supremac[ií]a racial|racial supremacy)/i, category: 'hate', reason: 'No admitimos odio, discriminación ni amenazas.' },
  { pattern: /(?:gore\b|decapitaci[oó]n|desmembramiento|graphic violence|dismember|tortura expl[ií]cita)/i, category: 'graphic_violence', reason: 'La violencia gráfica no puede aparecer en esta sala.' },
  { pattern: /(?:fabricar (?:una )?bomba|hacer (?:una )?bomba|build a bomb|how to kill|c[oó]mo asesinar|hackear cuentas|robar contraseñ|steal passwords)/i, category: 'illegal_instruction', reason: 'No admitimos instrucciones para causar daño o cometer delitos.' },
  { pattern: /(?:deepfake|suplantar|impersonate|sin consentimiento|without consent)/i, category: 'impersonation', reason: 'No admitimos suplantación ni deepfakes no autorizados.' },
  { pattern: /(?:https?:\/\/|www\.|javascript:|data:text|\[url|<script|<iframe)/i, category: 'external_link', reason: 'Los enlaces y contenido ejecutable requieren revisión y no están habilitados en la demo.' },
  { pattern: /(?:idiota de mierda|te voy a matar|kill yourself|kys\b|put[oa] de mierda)/i, category: 'harassment', reason: 'Mantén una conversación respetuosa y sin amenazas.' },
  { pattern: /(?:mickey mouse|disney|harry potter|spider[ -]?man|batman|super mario)/i, category: 'copyright', reason: 'Usa personajes originales y material para el que tengas autorización.' },
];

const commercialRules: typeof rules = [
  { pattern: /(?:vota por|vote for|campa[ñn]a pol[ií]tica|political campaign|elecciones|elecci[oó]n presidencial)/i, category: 'political_ad', reason: 'No admitimos publicidad política.' },
  { pattern: /(?:apuestas?|casino|gambling|sportsbook|loter[ií]a|betting)/i, category: 'gambling', reason: 'No admitimos publicidad de apuestas.' },
  { pattern: /(?:tabaco|tobacco|cigarr|vape|coca[ií]na|cocaine|fentanilo|fentanyl|marihuana|marijuana|cannabis|venta de armas|buy guns|alcohol)/i, category: 'regulated_goods', reason: 'No admitimos anuncios de productos regulados.' },
  { pattern: /(?:dinero f[aá]cil|ganancias garantizadas|guaranteed returns|hazte rico|estafa|phishing|esquema piramidal)/i, category: 'fraud', reason: 'No admitimos fraude ni promesas financieras engañosas.' },
];

export function moderateText(text: string, surface: ContentSurface): ModerationResult {
  const normalized = text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
  for (const rule of [...rules, ...(surface === 'advertisement' ? commercialRules : [])]) {
    if (rule.pattern.test(normalized)) return { approved: false, category: rule.category, reason: rule.reason };
  }
  return { approved: true };
}

export const MODERATION_LIMITATIONS = 'La demo usa reglas locales conservadoras, no un clasificador de seguridad completo. Producción permanece cerrada hasta conectar moderación de texto, imágenes y salida, revisión humana y persistencia.';
