/**
 * Basic French support without the AI brain: common French commands are mapped to English before parsing.
 * (With ANTHROPIC_API_KEY set, the AI brain understands any French and replies in French.)
 */
const PHRASES: [RegExp, string][] = [
  [/\bbonjour\b|\bbon matin\b/g, 'good morning'], [/\bbonne nuit\b/g, 'good night'], [/\bsoir[ée]e cin[ée]ma\b/g, 'movie night'],
  [/\bje (pars|quitte la maison)\b/g, "i'm leaving"], [/\bj'?ai froid\b/g, "i'm cold"], [/\bj'?ai chaud\b/g, "i'm hot"],
  [/\bquel temps fait[- ]il\b|\bla m[ée]t[ée]o\b/g, "what's the weather"], [/\bquelle heure est[- ]il\b/g, 'what time is it'],
  [/\b(allume[rz]?|ouvre la lumi[eè]re)\b/g, 'turn on'], [/\b([ée]teins|[ée]teindre|[ée]teignez)\b/g, 'turn off'],
  [/\btamise[rz]?\b|\bbaisse[rz]? (la|les) lumi[eè]res?\b/g, 'dim'], [/\b(ouvre[rz]?)\b/g, 'open'], [/\b(ferme[rz]?)\b/g, 'close'],
  [/\b(verrouille[rz]?|barre[rz]?)\b/g, 'lock'], [/\bd[ée]verrouille[rz]?\b/g, 'unlock'],
  [/\b(r[éeè]gle[rz]?|mets?|mettre) (la )?temp[ée]rature [àa]\b/g, 'set the temperature to'], [/\bdegr[ée]s?\b/g, 'degrees'],
  [/\bminuterie\b|\bminuteur\b/g, 'timer'], [/\bpour\b/g, 'for'], [/\bheures?\b/g, 'hours'], [/\bsecondes?\b/g, 'seconds'],
  [/\br[ée]veille[- ]moi\b/g, 'wake me up'], [/\brappelle[- ]moi de\b/g, 'remind me to'], [/\bannonce\b/g, 'announce'],
  [/\b(les |la |le |l')?lumi[eè]res?\b/g, 'the lights'], [/\b(les |le |la )?stores?\b|\b(les |le )?rideaux?\b/g, 'the blinds'],
  [/\b(la )?porte d'entr[ée]e\b/g, 'the front door'], [/\b(la )?porte du garage\b|\b(le )?garage\b/g, 'the garage'],
  [/\b(le |la )?t[ée]l[ée](vision)?\b/g, 'the tv'], [/\b(le )?ventilateur\b/g, 'the fan'], [/\b(la )?cafeti[eè]re\b/g, 'the coffee maker'],
  [/\b(du |le )?salon\b/g, 'living room'], [/\b(de la |la )?cuisine\b/g, 'kitchen'], [/\b(de la |la )?chambre\b/g, 'bedroom'],
  [/\b(du |le )?bureau\b/g, 'office'], [/\b(de l'|l')?entr[ée]e\b/g, 'entrance'], [/\btout\b/g, 'everything'],
  [/\bdans\b/g, 'in'], [/\b(\d{1,2}) ?h ?(\d{2})\b/g, '$1:$2'], [/\b(\d{1,2}) hours\b/g, '$1:00'], [/\bà\b/g, 'at'], [/\bet\b/g, 'and'], [/\bpour cent\b|%/g, ' percent'], [/\bs'il te pla[iî]t\b|\bs'il vous pla[iî]t\b/g, ''],
];

// JavaScript's \b doesn't treat accented letters (é, è…) as letters, so use a Unicode-aware word boundary.
const WB = String.raw`(?:(?<![\p{L}\d])(?=[\p{L}\d])|(?<=[\p{L}\d])(?![\p{L}\d]))`;
const UNICODE = PHRASES.map(([re, en]) => [new RegExp(re.source.replaceAll(String.raw`\b`, WB), 'gu'), en] as const);

export function frenchToEnglish(text: string): string {
  let t = ` ${text.toLowerCase()} `;
  for (const [re, en] of UNICODE) t = t.replace(re, en);
  return t.replace(/\s+/g, ' ').trim();
}
