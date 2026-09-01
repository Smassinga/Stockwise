import type { Dispatch, SetStateAction } from 'react'
import { Layers3, Search } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { PremiumEmptyState } from '../../components/premium/PremiumEmptyState'
import { PremiumStatusBadge } from '../../components/premium/PremiumStatusBadge'
import { deriveItemProfileWarnings, type ItemPrimaryRole } from '../../lib/itemProfiles'

type Translate = (key: string, fallback: string, vars?: Record<string, string | number>) => string
type RecipeStatusFilter = 'all' | 'active' | 'inactive'
type RecipeView = 'register' | 'create' | 'detail' | 'build'
type RecipeBom = {
  id: string
  product_id: string
  name: string
  version: string
  is_active: boolean
  assembly_time_per_unit_minutes: number | null
}
type RecipeItem = {
  id: string
  name: string
  sku?: string | null
  primary_role?: ItemPrimaryRole | null
  track_inventory?: boolean | null
  can_buy?: boolean | null
  can_sell?: boolean | null
  is_assembled?: boolean | null
  has_active_bom?: boolean | null
  used_as_component?: boolean | null
}

type BomRecipeRegisterProps = {
  tt: Translate
  view: RecipeView
  loadError: boolean
  recipeQuery: string
  setRecipeQuery: Dispatch<SetStateAction<string>>
  recipeStatusFilter: RecipeStatusFilter
  setRecipeStatusFilter: Dispatch<SetStateAction<RecipeStatusFilter>>
  filteredRecipes: RecipeBom[]
  boms: RecipeBom[]
  itemById: Map<string, RecipeItem>
  componentCounts: Record<string, number>
  canBuildAssembly: boolean
  canManageBom: boolean
  formatPlanningDuration: (minutes: number | null | undefined) => string
  openRecipe: (bomId: string) => void
  openBuild: (bomId: string) => void
  setView: (view: RecipeView, bomId?: string) => void
}

const num = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback

export function BomRecipeRegister({
  tt,
  view,
  loadError,
  recipeQuery,
  setRecipeQuery,
  recipeStatusFilter,
  setRecipeStatusFilter,
  filteredRecipes,
  boms,
  itemById,
  componentCounts,
  canBuildAssembly,
  canManageBom,
  formatPlanningDuration,
  openRecipe,
  openBuild,
  setView,
}: BomRecipeRegisterProps) {
  return (
    <>
      {view === 'register' && !loadError ? (
        <section className="space-y-4" aria-labelledby="recipe-register-title">
          <div className="grid gap-3 border-y border-card-border bg-surface-muted/30 py-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={recipeQuery}
                onChange={(event) => setRecipeQuery(event.target.value)}
                placeholder={tt('productionUx.recipe.search', 'Search Recipes, finished items, or SKUs')}
                className="pl-9"
              />
            </div>
            <Select value={recipeStatusFilter} onValueChange={(value) => setRecipeStatusFilter(value as typeof recipeStatusFilter)}>
              <SelectTrigger aria-label={tt('productionUx.recipe.statusFilter', 'Recipe status filter')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tt('productionUx.allStatuses', 'All statuses')}</SelectItem>
                <SelectItem value="active">{tt('common.active', 'Active')}</SelectItem>
                <SelectItem value="inactive">{tt('common.inactive', 'Inactive')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="recipe-register-title" className="text-lg font-semibold">{tt('productionUx.recipe.register', 'Recipe register')}</h2>
              <p className="text-sm text-muted-foreground">
                {tt('productionUx.recipe.registerHelp', '{count} maintained versions in the current view').replace('{count}', String(filteredRecipes.length))}
              </p>
            </div>
          </div>

          {filteredRecipes.length ? (
            <div className="divide-y border-y border-card-border">
              {filteredRecipes.map((bom) => {
                const product = itemById.get(bom.product_id)
                const componentsForBom = componentCounts[bom.id] || 0
                const warnings = product
                  ? deriveItemProfileWarnings({
                      primaryRole: product.primary_role || 'general',
                      trackInventory: Boolean(product.track_inventory ?? true),
                      canBuy: Boolean(product.can_buy ?? true),
                      canSell: Boolean(product.can_sell ?? true),
                      isAssembled: Boolean(product.is_assembled),
                      hasActiveBom: Boolean(product.has_active_bom),
                      usedAsComponent: Boolean(product.used_as_component),
                      minStock: 0,
                    })
                  : []
                return (
                  <article key={bom.id} className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)_auto] lg:items-center">
                    <div className="flex min-w-0 items-start justify-between gap-3 lg:block">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-muted-foreground">{product?.sku || tt('productionUx.noSku', 'No SKU')}</p>
                        <h3 className="mt-1 text-base font-semibold">{product?.name || tt('productionUx.finishedItem', 'Finished item')}</h3>
                        <p className="mt-1 truncate text-sm">{bom.name} · {tt('bom.recipeVersion', 'Version')} {bom.version}</p>
                      </div>
                      <PremiumStatusBadge tone={bom.is_active ? 'positive' : 'neutral'}>
                        {bom.is_active ? tt('common.active', 'Active') : tt('common.inactive', 'Inactive')}
                      </PremiumStatusBadge>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">{tt('productionUx.components', 'Components')}</dt>
                        <dd className="mt-1 font-medium">{componentsForBom}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{tt('productionUx.planningTime', 'Planning time')}</dt>
                        <dd className="mt-1 font-medium">
                          {num(bom.assembly_time_per_unit_minutes) > 0
                            ? formatPlanningDuration(bom.assembly_time_per_unit_minutes)
                            : tt('productionUx.timeNotConfigured', 'Not configured')}
                        </dd>
                      </div>
                    </dl>
                    {warnings.length || componentsForBom === 0 ? (
                      <p className="text-xs text-status-warning-foreground">
                        {componentsForBom === 0
                          ? tt('productionUx.recipe.noComponents', 'Add at least one component before assembly.')
                          : tt('productionUx.recipe.profileWarning', 'Review the finished-item profile before assembly.')}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Button size="sm" onClick={() => openRecipe(bom.id)}>
                        {tt('productionUx.viewRecipe', 'View Recipe')}
                      </Button>
                      {canBuildAssembly && bom.is_active && componentsForBom > 0 ? (
                        <Button size="sm" variant="outline" onClick={() => openBuild(bom.id)}>
                          {tt('productionUx.quickAssembly', 'Quick Assembly')}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <PremiumEmptyState
              icon={<Layers3 />}
              title={boms.length ? tt('productionUx.recipe.filteredEmpty', 'No Recipes match the filters') : tt('bom.empty.title', 'Create your first Recipe')}
              description={tt('bom.empty.body', 'Use Recipes & Assemblies for simple ingredient or component transformations into finished stock.')}
              action={canManageBom ? <Button onClick={() => setView('create')}>{tt('bom.empty.action', 'Create first Recipe')}</Button> : null}
            />
          )}
        </section>
      ) : null}


    </>
  )
}
