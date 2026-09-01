import fs from 'node:fs'

const pagePath = 'src/pages/BOM.tsx'
const componentPath = 'src/features/bom/BomRecipeRegister.tsx'
let source = fs.readFileSync(pagePath, 'utf8')

const componentImport = "import { BomRecipeRegister } from '../features/bom/BomRecipeRegister'\n"
const importAnchor = "import { formatOperationalQuantity } from '../lib/operationalQuantity'\n"
if (!source.includes(componentImport)) {
  if (!source.includes(importAnchor)) throw new Error('BOM import anchor not found')
  source = source.replace(importAnchor, `${importAnchor}${componentImport}`)
}

const start = "      {view === 'register' && !loadError ? ("
const next = "      {(view === 'detail' || view === 'build') && selectedBom ? ("
const startIndex = source.indexOf(start)
const nextIndex = source.indexOf(next, startIndex)
if (startIndex < 0 || nextIndex < 0 || nextIndex <= startIndex) throw new Error('BOM register boundaries not found')
const block = source.slice(startIndex, nextIndex)
if (!block.trimEnd().endsWith(') : null}')) throw new Error('BOM register block did not end at expected conditional boundary')

const component = `import type { Dispatch, SetStateAction } from 'react'\nimport { Layers3, Search } from 'lucide-react'\nimport { Button } from '../../components/ui/button'\nimport { Input } from '../../components/ui/input'\nimport { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'\nimport { PremiumEmptyState } from '../../components/premium/PremiumEmptyState'\nimport { PremiumStatusBadge } from '../../components/premium/PremiumStatusBadge'\nimport { deriveItemProfileWarnings, type ItemPrimaryRole } from '../../lib/itemProfiles'\n\ntype Translate = (key: string, fallback: string, vars?: Record<string, string | number>) => string\ntype RecipeStatusFilter = 'all' | 'active' | 'inactive'\ntype RecipeView = 'register' | 'create' | 'detail' | 'build'\ntype RecipeBom = {\n  id: string\n  product_id: string\n  name: string\n  version: string\n  is_active: boolean\n  assembly_time_per_unit_minutes: number | null\n}\ntype RecipeItem = {\n  id: string\n  name: string\n  sku?: string | null\n  primary_role?: ItemPrimaryRole | null\n  track_inventory?: boolean | null\n  can_buy?: boolean | null\n  can_sell?: boolean | null\n  is_assembled?: boolean | null\n  has_active_bom?: boolean | null\n  used_as_component?: boolean | null\n}\n\ntype BomRecipeRegisterProps = {\n  tt: Translate\n  view: RecipeView\n  loadError: boolean\n  recipeQuery: string\n  setRecipeQuery: Dispatch<SetStateAction<string>>\n  recipeStatusFilter: RecipeStatusFilter\n  setRecipeStatusFilter: Dispatch<SetStateAction<RecipeStatusFilter>>\n  filteredRecipes: RecipeBom[]\n  boms: RecipeBom[]\n  itemById: Map<string, RecipeItem>\n  componentCounts: Record<string, number>\n  canBuildAssembly: boolean\n  canManageBom: boolean\n  formatPlanningDuration: (minutes: number | null | undefined) => string\n  openRecipe: (bomId: string) => void\n  openBuild: (bomId: string) => void\n  setView: (view: RecipeView, bomId?: string) => void\n}\n\nconst num = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback\n\nexport function BomRecipeRegister({\n  tt,\n  view,\n  loadError,\n  recipeQuery,\n  setRecipeQuery,\n  recipeStatusFilter,\n  setRecipeStatusFilter,\n  filteredRecipes,\n  boms,\n  itemById,\n  componentCounts,\n  canBuildAssembly,\n  canManageBom,\n  formatPlanningDuration,\n  openRecipe,\n  openBuild,\n  setView,\n}: BomRecipeRegisterProps) {\n  return (\n    <>\n${block}\n    </>\n  )\n}\n`
fs.mkdirSync('src/features/bom', { recursive: true })
fs.writeFileSync(componentPath, component)

const replacement = `      <BomRecipeRegister\n        tt={tt}\n        view={view}\n        loadError={loadError}\n        recipeQuery={recipeQuery}\n        setRecipeQuery={setRecipeQuery}\n        recipeStatusFilter={recipeStatusFilter}\n        setRecipeStatusFilter={setRecipeStatusFilter}\n        filteredRecipes={filteredRecipes}\n        boms={boms}\n        itemById={itemById}\n        componentCounts={componentCounts}\n        canBuildAssembly={canBuildAssembly}\n        canManageBom={canManageBom}\n        formatPlanningDuration={formatPlanningDuration}\n        openRecipe={openRecipe}\n        openBuild={openBuild}\n        setView={setView}\n      />\n\n`
source = `${source.slice(0, startIndex)}${replacement}${source.slice(nextIndex)}`
source = source.replace('  Layers3,\n', '')
source = source.replace('  Search,\n', '')
fs.writeFileSync(pagePath, source)
console.log('Extracted BOM recipe register component')
