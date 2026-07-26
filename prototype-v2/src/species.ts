import traitsCsv from '../../data/species_traits_tt_v1.csv?raw'
import profilesCsv from '../../data/species_profiles_v4.csv?raw'

export type Strategy = 'sun' | 'shade' | 'broad'

export type TraitConfidence = 'low' | 'medium' | 'high'

export interface SpeciesProfile {
  archetype: string
  lightCompensation: number
  lightSaturation: number
  maxAssimilation: number
  growthRate: number
  lowLightSurvival: number
  seedMass: number
  seedOutput: number
  dispersal: number
  establishment: number
  woodDensity: number
  windResistance: number
  recovery: number
  herbivoryDefense: number
  crownScale: number
  maturityFraction: number
  confidence: TraitConfidence
  playStrength: string
  tradeoff: string
  provenance: string
}

export interface Species {
  code: string
  name: string
  latin: string
  strategy: Strategy
  maxHeight: number
  lightPreference: string
  environment: string
  profile: SpeciesProfile
}

export const STRATEGIES: Record<
  Strategy,
  { name: string; short: string; color: number; css: string; description: string }
> = {
  sun: {
    name: '喜阳先锋型',
    short: '喜阳',
    color: 0xe9933e,
    css: '#e9933e',
    description: '高光回报高，密闭林下亏损快。',
  },
  shade: {
    name: '耐荫等待型',
    short: '耐荫',
    color: 0x627bb6,
    css: '#627bb6',
    description: '低光下维持幼苗库，等待林窗释放；并非偏好最暗环境。',
  },
  broad: {
    name: '广适竞争型',
    short: '广适',
    color: 0x4e9a70,
    css: '#4e9a70',
    description: '环境适应范围宽，收益和风险居中。',
  },
}

const strategyByChinese: Record<string, Strategy> = {
  喜阳先锋型: 'sun',
  喜阴耐受型: 'shade',
  广适竞争型: 'broad',
}

const profileByCode = new Map<string, SpeciesProfile>(
  profilesCsv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const columns = line.split(',')
      return [columns[0], {
        archetype: columns[1],
        lightCompensation: Number(columns[2]),
        lightSaturation: Number(columns[3]),
        maxAssimilation: Number(columns[4]),
        growthRate: Number(columns[5]),
        lowLightSurvival: Number(columns[6]),
        seedMass: Number(columns[7]),
        seedOutput: Number(columns[8]),
        dispersal: Number(columns[9]),
        establishment: Number(columns[10]),
        woodDensity: Number(columns[11]),
        windResistance: Number(columns[12]),
        recovery: Number(columns[13]),
        herbivoryDefense: Number(columns[14]),
        crownScale: Number(columns[15]),
        maturityFraction: Number(columns[16]),
        confidence: columns[17] as TraitConfidence,
        playStrength: columns[18],
        tradeoff: columns[19],
        provenance: columns[20],
      }]
    }),
)

export const SPECIES: Species[] = traitsCsv
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const columns = line.split(',')
    const profile = profileByCode.get(columns[0])
    if (!profile) throw new Error(`Missing V4 species profile for ${columns[0]}`)
    return {
      code: columns[0],
      name: columns[1],
      latin: columns[2],
      strategy: strategyByChinese[columns[3]],
      environment: columns[4],
      maxHeight: Number(columns[6]),
      lightPreference: columns[7],
      profile,
    }
  })
