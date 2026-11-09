const countryAliases: Array<[RegExp, string]> = [
  [/\bafghanistan\b/i, "af"], [/\balbania\b/i, "al"], [/\balgeria\b/i, "dz"],
  [/\bargentina\b/i, "ar"], [/\baustralia\b/i, "au"], [/\baustria\b/i, "at"],
  [/\bbangladesh\b/i, "bd"], [/\bbelgium\b/i, "be"], [/\bbolivia\b/i, "bo"],
  [/\bbosnia(?: and herzegovina)?\b/i, "ba"], [/\bbrazil\b/i, "br"], [/\bbulgaria\b/i, "bg"],
  [/\bcameroon\b/i, "cm"], [/\bcanada\b/i, "ca"], [/\bchile\b/i, "cl"],
  [/\bchina\b/i, "cn"], [/\bcolombia\b/i, "co"], [/\bcosta rica\b/i, "cr"],
  [/\bcroatia\b/i, "hr"], [/\bcyprus\b/i, "cy"], [/\bczech(?:ia| republic)?\b/i, "cz"],
  [/\bdenmark\b/i, "dk"], [/\becuador\b/i, "ec"], [/\begypt\b/i, "eg"],
  [/\bengland\b/i, "gb-eng"], [/\bestonia\b/i, "ee"], [/\bethiopia\b/i, "et"],
  [/\bfinland\b/i, "fi"], [/\bfrance\b/i, "fr"], [/\bgeorgia\b/i, "ge"],
  [/\bgermany\b/i, "de"], [/\bghana\b/i, "gh"], [/\bgreece\b/i, "gr"],
  [/\bhong kong\b/i, "hk"], [/\bhungary\b/i, "hu"], [/\biceland\b/i, "is"],
  [/\bindia\b/i, "in"], [/\bindonesia\b/i, "id"], [/\biran\b/i, "ir"],
  [/\biraq\b/i, "iq"], [/\bireland\b/i, "ie"], [/\bisrael\b/i, "il"],
  [/\bitaly\b/i, "it"], [/\bjamaica\b/i, "jm"], [/\bjapan\b/i, "jp"],
  [/\bjordan\b/i, "jo"], [/\bkenya\b/i, "ke"], [/\bkuwait\b/i, "kw"],
  [/\blatvia\b/i, "lv"], [/\blebanon\b/i, "lb"], [/\blithuania\b/i, "lt"],
  [/\bmalaysia\b/i, "my"], [/\bmexico\b/i, "mx"], [/\bmoldova\b/i, "md"],
  [/\bmontenegro\b/i, "me"], [/\bmorocco\b/i, "ma"], [/\bnamibia\b/i, "na"],
  [/\bnepal\b/i, "np"], [/\bnetherlands\b/i, "nl"], [/\bnew zealand\b/i, "nz"],
  [/\bnigeria\b/i, "ng"], [/\bnorth macedonia\b/i, "mk"], [/\bnorthern ireland\b/i, "gb-nir"],
  [/\bnorway\b/i, "no"], [/\boman\b/i, "om"], [/\bpakistan\b/i, "pk"],
  [/\bpanama\b/i, "pa"], [/\bparaguay\b/i, "py"], [/\bperu\b/i, "pe"],
  [/\bphilippines\b/i, "ph"], [/\bpoland\b/i, "pl"], [/\bportugal\b/i, "pt"],
  [/\bqatar\b/i, "qa"], [/\bromania\b/i, "ro"], [/\brussia\b/i, "ru"],
  [/\bsaudi arabia\b/i, "sa"], [/\bscotland\b/i, "gb-sct"], [/\bsenegal\b/i, "sn"],
  [/\bserbia\b/i, "rs"], [/\bsingapore\b/i, "sg"], [/\bslovakia\b/i, "sk"],
  [/\bslovenia\b/i, "si"], [/\bsouth africa\b/i, "za"], [/\bsouth korea\b|\bkorea republic\b/i, "kr"],
  [/\bspain\b/i, "es"], [/\bsri lanka\b/i, "lk"], [/\bsudan\b/i, "sd"],
  [/\bsweden\b/i, "se"], [/\bswitzerland\b/i, "ch"], [/\bthailand\b/i, "th"],
  [/\btunisia\b/i, "tn"], [/\bturkey\b|\bturkiye\b/i, "tr"], [/\buganda\b/i, "ug"],
  [/\bukraine\b/i, "ua"], [/\bunited arab emirates\b|\buae\b/i, "ae"],
  [/\bunited states\b|\busa\b/i, "us"], [/\buruguay\b/i, "uy"], [/\bvenezuela\b/i, "ve"],
  [/\bvietnam\b/i, "vn"], [/\bwales\b/i, "gb-wls"], [/\bzambia\b/i, "zm"],
  [/\bzimbabwe\b/i, "zw"],
];

const leagueCountryRules: Array<[RegExp, string]> = [
  [/\b(epl|premier league)\b/i, "gb-eng"],
  [/\bchampionship\b/i, "gb-eng"],
  [/\bla liga\b/i, "es"],
  [/\bbundesliga\b/i, "de"],
  [/\bserie a\b/i, "it"],
  [/\bligue 1\b|\bligue one\b/i, "fr"],
  [/\bmls\b/i, "us"],
  [/\b(nba|nfl|mlb|ncaa|wnba)\b/i, "us"],
  [/\bnhl\b/i, "ca"],
  [/\bbig bash\b/i, "au"],
  [/\bindian premier league\b|\bipl\b/i, "in"],
  [/\bpakistan super league\b|\bpsl\b/i, "pk"],
];

const explicitCountryCodes: Record<string, string> = {
  uk: "gb", gb: "gb", england: "gb-eng", scotland: "gb-sct", wales: "gb-wls",
  eu: "eu", usa: "us", us: "us", uae: "ae", ca: "ca", au: "au", nz: "nz",
};

export function countryCodeFromName(value?: string | null) {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  const direct = explicitCountryCodes[candidate.toLowerCase()];
  if (direct) return direct;
  return countryAliases.find(([pattern]) => pattern.test(candidate))?.[1];
}

export function leagueCountryCode(league?: string | null, country?: string | null) {
  const fromLeague = leagueCountryRules.find(([pattern]) => pattern.test(league || ""))?.[1];
  return fromLeague || countryCodeFromName(country);
}

export function teamCountryCode(team?: string | null, fallback?: string) {
  return countryCodeFromName(team) || fallback;
}

