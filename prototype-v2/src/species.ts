import traitsCsv from '../../data/species_traits_tt_v1.csv?raw'

export type Strategy = 'sun' | 'shade' | 'broad'

export interface Species {
  code: string
  name: string
  latin: string
  strategy: Strategy
  maxHeight: number
  lightPreference: string
  environment: string
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
    name: '喜阴耐受型',
    short: '喜阴',
    color: 0x627bb6,
    css: '#627bb6',
    description: '低光下收入低但稳定，增长较慢。',
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

export const SPECIES: Species[] = traitsCsv
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const columns = line.split(',')
    return {
      code: columns[0],
      name: columns[1],
      latin: columns[2],
      strategy: strategyByChinese[columns[3]],
      environment: columns[4],
      maxHeight: Number(columns[6]),
      lightPreference: columns[7],
    }
  })

