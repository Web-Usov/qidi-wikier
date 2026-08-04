export interface EntityProfile {
  materials: string[];
  materialFamilies: string[];
  primaryMaterialFamilies: string[];
  printers: string[];
  components: string[];
  brands: string[];
}

const MATERIALS: Array<[string, string, RegExp]> = [
  ["ABS-CF", "ABS", /(?:\babs\s*[-_/ ]?cf\b|\bабс\s*[-_/ ]?cf\b|абс.{0,16}(?:карбон|угленаполн))/iu],
  ["ABS-GF", "ABS", /(?:\babs\s*[-_/ ]?gf\b|\bабс\s*[-_/ ]?gf\b|абс.{0,16}стеклонаполн)/iu],
  ["PA6-CF", "PA6", /(?:\bpa\s*6\s*[-_/ ]?cf\b|па\s*6.{0,12}(?:cf|карбон|угленаполн))/iu],
  ["PA6-GF", "PA6", /(?:\bpa\s*6\s*[-_/ ]?gf\b|па\s*6.{0,12}(?:gf|стеклонаполн))/iu],
  ["PA12-CF", "PA12", /(?:\bpa\s*12\s*[-_/ ]?cf\b|па\s*12.{0,12}(?:cf|карбон|угленаполн))/iu],
  ["PA12-GF", "PA12", /(?:\bpa\s*12\s*[-_/ ]?gf\b|па\s*12.{0,12}(?:gf|стеклонаполн))/iu],
  ["PETG-CF", "PETG", /\bpetg\s*[-_/ ]?cf\b|пэтг.{0,12}(?:cf|карбон|угленаполн)/iu],
  ["PLA-CF", "PLA", /\bpla\s*[-_/ ]?cf\b|пла.{0,12}(?:cf|карбон|угленаполн)/iu],
  ["ABS", "ABS", /\babs\b|\bабс\b/iu],
  ["ASA", "ASA", /\basa\b|\bаса\b/iu],
  ["PETG", "PETG", /\bpetg\b|\bпэтг\b|\bпетг\b/iu],
  ["PLA", "PLA", /\bpla\b|\bпла\b/iu],
  ["TPU", "TPU", /\btpu\b|\bтпу\b/iu],
  ["PA6", "PA6", /\bpa\s*6\b|\bпа\s*6\b|\bnylon\b|\bнейлон\b/iu],
  ["PA12", "PA12", /\bpa\s*12\b|\bпа\s*12\b/iu],
  ["PC", "PC", /\bpc\b|\bполикарбонат/iu],
  ["PPS", "PPS", /\bpps\b/iu],
  ["PEEK", "PEEK", /\bpeek\b/iu],
  ["POM", "POM", /\bpom\b|\bпом\b|полиацетал/iu],
  ["PP", "PP", /\bpp\b|полипропилен/iu],
  ["Resin", "RESIN", /\bresin\b|\bсмол[аы]\b/iu],
];

const PRINTERS: Array<[string, RegExp]> = [
  ["QIDI-Q2", /\bqidi\s*q2\b|\bq2\b|\bку2\b/iu],
  ["QIDI-Q1-PRO", /\bqidi\s*q1\b|\bq1\s*pro\b|\bку1\b/iu],
  ["QIDI-PLUS4", /\bplus\s*4\b|\bплюс\s*4\b|\b4\s*plus\b/iu],
  ["QIDI-XMAX3", /\bx[- ]?max\s*3\b|\bмакс\s*3\b/iu],
  ["QIDI-XPLUS3", /\bx[- ]?plus\s*3\b/iu],
  ["QIDI-BOX", /\bqidi\s*box\b|\bgd[- ]?box\b|\bчиди\s*бокс\b/iu],
  ["BAMBU", /\bbambu\b|\bбамбук/iu],
  ["CREALITY", /\bcreality\b|\bкреалити\b/iu],
];

const COMPONENTS: Array<[string, RegExp]> = [
  ["filament-sensor", /датчик.{0,20}(?:филамент|конц|налич)|runout/iu],
  ["pause", /\bпауз[ауеы]\b|уходит.{0,12}пауз/iu],
  ["nozzle", /\bсопл[оаеуы]\b|\bnozzle\b/iu],
  ["hotend", /\bхотэнд|\bhotend\b/iu],
  ["extruder", /\bэкструдер|\bextruder\b/iu],
  ["belts", /\bремн[иея]|\bремеш|\bbelt/iu],
  ["pulley", /\bшкив|\bpulley/iu],
  ["bed-mesh", /\bmesh\b|карт[ау].{0,12}стол|bed\s*mesh/iu],
  ["z-offset", /z[-_ ]?offset|оффсет.{0,8}z/iu],
  ["bed", /\bстол[аеуы]?\b|\bbed\b/iu],
  ["chamber", /\bкамер[аеуы]?\b|\bchamber\b/iu],
  ["cooling", /\bобдув|\bвентилятор|\bfan\b/iu],
  ["spool", /\bкатушк|\bspool\b|\bнамотк/iu],
  ["ptfe", /\bptfe\b|тефлонов.{0,8}труб/iu],
  ["firmware-config", /\bконфиг|printer\.cfg|config\.cfg|\bпрошив|\bfirmware\b/iu],
  ["supports", /\bподдержк|\bsupports?\b/iu],
  ["seam", /\b(?:шов|шва|шву|швом|шве|швы|швов|швам|швами|швах)\b|\bseam\b/iu],
  ["layer-adhesion", /межсло|рассло|деламинац|слои.{0,20}(?:расход|лома|держ)/iu],
  ["warping", /\bварпинг|загибает|загибается|угол.{0,12}(?:подня|оторв|загнул)/iu],
  ["clog", /\bзасор|\bпробк|\bclog/iu],
  ["drying", /\bсушк|\bсуши|\bпросуш/iu],
  ["temperature", /температур|\b\d{2,3}\s*°?c\b/iu],
  ["speed", /скорост|мм\/с|mm\/s/iu],
  ["camera", /\bкамер[ау]\b|\bcamera\b/iu],
  ["input-shaping", /input\s*shap|шейпер|резонанс/iu],
  ["pressure-advance", /pressure\s*advance|\bpa\s*tower|\bпа\s*баш/iu],
];

const BRANDS: Array<[string, RegExp]> = [
  ["Bestfilament", /best\s*filament|bestfilament|бестфиламент/iu],
  ["Filamentarno", /filamentarno|филаментарно/iu],
  ["eSUN", /\besun\b|\be-sun\b|\bисан\b/iu],
  ["Fusrock", /fus\s*rock|fusrock|фусрок/iu],
  ["Exoflex", /exoflex|экзофлекс/iu],
  ["MAKO", /\bmako\b|\bмако\b/iu],
  ["FDplast", /fdplast|фдпласт/iu],
  ["Polymaker", /polymaker|полимейкер/iu],
  ["NIT", /\bnit\b|\bнит\b/iu],
  ["U3Print", /u3print|ю3принт/iu],
  ["Kingroon", /kingroon|кингрун/iu],
];

function matches(list: Array<[string, RegExp]>, text: string): string[] {
  return list.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function matchPositions(pattern: RegExp, text: string): Array<{ index: number; value: string }> {
  const flags = [...new Set(`${pattern.flags.replace(/g/g, "")}g`.split(""))].join("");
  const globalPattern = new RegExp(pattern.source, flags);
  return [...text.matchAll(globalPattern)].map((match) => ({ index: match.index ?? 0, value: match[0] }));
}

function detectPrimaryMaterialFamilies(text: string): string[] {
  const scores = new Map<string, number>();
  for (const [, family, pattern] of MATERIALS) {
    for (const match of matchPositions(pattern, text)) {
      const context = text.slice(
        Math.max(0, match.index - 60),
        Math.min(text.length, match.index + match.value.length + 60),
      );
      let score = 1;
      if (match.index < 280) score += 1.5;
      if (/(?:печатаю|печатал|печать|материал|пластик|филамент|зарядил|заправил|сушил|сушу|температур|сопл|стол|камера|первый раз|пробую)/iu.test(context)) score += 1;
      scores.set(family, (scores.get(family) ?? 0) + score);
    }
  }

  const ranked = [...scores.entries()]
    .map(([family, score]) => ({ family, score }))
    .sort((a, b) => b.score - a.score || a.family.localeCompare(b.family));
  const first = ranked[0];
  const second = ranked[1];
  if (!first || first.score < 2.5) return [];
  if (!second || first.score >= second.score + 2 || first.score >= second.score * 1.6) return [first.family];
  return [];
}

export function extractEntities(text: string): EntityProfile {
  const materialMatches = MATERIALS.filter(([, , pattern]) => pattern.test(text));
  return {
    materials: [...new Set(materialMatches.map(([name]) => name))],
    materialFamilies: [...new Set(materialMatches.map(([, family]) => family))],
    primaryMaterialFamilies: detectPrimaryMaterialFamilies(text),
    printers: [...new Set(matches(PRINTERS, text))],
    components: [...new Set(matches(COMPONENTS, text))],
    brands: [...new Set(matches(BRANDS, text))],
  };
}

export function entityIntersection(a: string[], b: string[]): string[] {
  const right = new Set(b);
  return a.filter((value) => right.has(value));
}

export function entityProfilesConflict(a: EntityProfile, b: EntityProfile): string[] {
  const conflicts: string[] = [];
  if (
    a.primaryMaterialFamilies.length === 1
    && b.primaryMaterialFamilies.length === 1
    && entityIntersection(a.primaryMaterialFamilies, b.primaryMaterialFamilies).length === 0
  ) {
    conflicts.push(`разные основные материалы: ${a.primaryMaterialFamilies[0]} vs ${b.primaryMaterialFamilies[0]}`);
  }
  if (a.materialFamilies.length && b.materialFamilies.length && entityIntersection(a.materialFamilies, b.materialFamilies).length === 0) {
    conflicts.push(`разные материалы: ${a.materialFamilies.join("/")} vs ${b.materialFamilies.join("/")}`);
  }
  if (a.printers.length && b.printers.length && entityIntersection(a.printers, b.printers).length === 0) {
    conflicts.push(`разные принтеры: ${a.printers.join("/")} vs ${b.printers.join("/")}`);
  }
  return conflicts;
}
