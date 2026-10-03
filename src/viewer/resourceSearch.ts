/** Search aliases only: these readings never replace official source names. */
const enemyReadings: Readonly<Record<string, string>> = {
    'お菓子': 'okashi', 'くまのこのゆめ': 'kuma no ko no yume', 'くるみ割り': 'kurumiwari',
    'やぎのこのゆめ': 'yagi no ko no yume', 'キレートビッグフェリス': 'kireeto biggu ferisu',
    'キレートマスコット': 'kireeto masukotto', 'コグマ': 'koguma', 'コヤギ': 'koyagi',
    'ゴム': 'gomu', 'チョコレート': 'chokoreeto', 'ハコ': 'hako', 'ベベ': 'bebe',
    'マチビト馬': 'machibito uma', '人魚': 'ningyo', '偽街の子供達': 'nisemachi no kodomotachi',
    '兵士': 'heishi', '口寄せ絵馬': 'kuchiyose ema', '名無しメール': 'nanashi meeru',
    '名無し人工知能': 'nanashi jinkou chinou', '女王の黄昏': 'joou no tasogare',
    '委員長': 'iinchou', '幸福な': 'koufuku na', '幸福': 'koufuku', '影': 'kage',
    '批評家': 'hihyouka', '暗闇': 'kurayami', '泣きウサギ': 'naki usagi', '犬': 'inu',
    '砂場': 'sunaba', '立ち耳': 'tachimimi', '糸車': 'itoguruma', '舞台装置': 'butai souchi',
    '芸術家': 'geijutsuka', '落書き': 'rakugaki', '薔薇園': 'baraen', '象徴': 'shouchou',
    '針': 'hari', '銀': 'gin', '鳥かご': 'torikago',
}

const romanizedEnemyNames = new Map<string, string>()

export function enemyRomanizedName(name: string | null | undefined): string {
    if (!name) return ''
    const cached = romanizedEnemyNames.get(name)
    if (cached !== undefined) return cached
    let value = name || ''
    value = value.replace('【天辺越えの姿】', '[Teppen goe no sugata] ')
        .replace('【天辺の姿】', '[Teppen no sugata] ')
    for (const [japanese, reading] of Object.entries(enemyReadings)) value = value.replaceAll(japanese, reading)
    value = value.replaceAll('の魔女', ' no majo').replaceAll('の手下', ' no teshita')
        .replaceAll('のウワサ', ' no uwasa').replaceAll('魔女', ' majo').trim()
    romanizedEnemyNames.set(name, value)
    return value
}

function normalize(value: unknown) {
    return String(value ?? '').normalize('NFKD')
        .replace(/([A-Za-z])[\u0300-\u036f]+/g, '$1').normalize('NFKC').toLowerCase()
        .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

export function matchesResourceSearch(query: string, fields: readonly unknown[]): boolean {
    const searchable = normalize(fields.filter(value => value != null).join(' '))
    return normalize(query).trim().split(/\s+/).filter(Boolean).every(token => searchable.includes(token))
}
