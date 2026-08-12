import { useEffect, useMemo, useState } from 'react'
import { Archive, RotateCcw, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { useOrg } from '../../hooks/useOrg'
import { can, type CompanyRole } from '../../lib/permissions'
import { useI18n } from '../../lib/i18n'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

type RecipeRow = {
  id: string
  name: string
  version: string | null
  is_active: boolean | null
  product_id: string
}

type BuildRow = {
  id: string
  bom_id: string
  product_id: string
  qty: number
  cost_total: number | null
  created_at: string
  status: 'posted' | 'reversed'
  reversed_at: string | null
  reversal_reason: string | null
}

type ItemRow = {
  id: string
  name: string
  sku: string | null
}

const requestKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const shortId = (value: string) => (value.length > 8 ? value.slice(0, 8).toUpperCase() : value.toUpperCase())

export function ProductionMaintenancePanel() {
  const { companyId, myRole } = useOrg()
  const { lang } = useI18n()
  const pt = String(lang || '').toLowerCase().startsWith('pt')
  const copy = (ptText: string, enText: string) => (pt ? ptText : enText)
  const role = (myRole as CompanyRole | null) ?? null
  const canRemoveRecipe = can.deleteMaster(role)
  const canReverseBuild = can.deleteMovement(role)

  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [builds, setBuilds] = useState<BuildRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [selectedRecipeId, setSelectedRecipeId] = useState('')
  const [selectedBuildId, setSelectedBuildId] = useState('')
  const [reverseReason, setReverseReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [reversing, setReversing] = useState(false)

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const recipeById = useMemo(() => new Map(recipes.map((recipe) => [recipe.id, recipe])), [recipes])
  const selectedRecipe = selectedRecipeId ? recipeById.get(selectedRecipeId) || null : null
  const selectedBuild = builds.find((build) => build.id === selectedBuildId) || null

  async function load() {
    if (!companyId) {
      setRecipes([])
      setBuilds([])
      setItems([])
      setSelectedRecipeId('')
      setSelectedBuildId('')
      return
    }

    setLoading(true)
    try {
      const [recipeRes, buildRes, itemRes] = await Promise.all([
        supabase
          .from('boms')
          .select('id,name,version,is_active,product_id')
          .eq('company_id', companyId)
          .order('name', { ascending: true }),
        supabase
          .from('builds')
          .select('id,bom_id,product_id,qty,cost_total,created_at,status,reversed_at,reversal_reason')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(12),
        supabase
          .from('items')
          .select('id,name,sku')
          .eq('company_id', companyId)
          .order('name', { ascending: true }),
      ])

      if (recipeRes.error) throw recipeRes.error
      if (buildRes.error) throw buildRes.error
      if (itemRes.error) throw itemRes.error

      const nextRecipes = (recipeRes.data || []) as RecipeRow[]
      const nextBuilds = ((buildRes.data || []) as Array<Partial<BuildRow> & Pick<BuildRow, 'id' | 'bom_id' | 'product_id' | 'qty' | 'created_at'>>).map((row) => ({
        ...row,
        cost_total: row.cost_total ?? null,
        status: row.status === 'reversed' ? 'reversed' : 'posted',
        reversed_at: row.reversed_at ?? null,
        reversal_reason: row.reversal_reason ?? null,
      })) as BuildRow[]

      setRecipes(nextRecipes)
      setBuilds(nextBuilds)
      setItems((itemRes.data || []) as ItemRow[])

      setSelectedRecipeId((current) => current && nextRecipes.some((recipe) => recipe.id === current)
        ? current
        : nextRecipes[0]?.id || '')
      setSelectedBuildId((current) => current && nextBuilds.some((build) => build.id === current)
        ? current
        : nextBuilds.find((build) => build.status === 'posted')?.id || nextBuilds[0]?.id || '')
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || copy('Não foi possível carregar os controlos de produção.', 'Could not load production controls.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function removeRecipe() {
    if (!selectedRecipe || !canRemoveRecipe) return

    const confirmed = window.confirm(copy(
      `Remover a receita “${selectedRecipe.name}”? Se nunca foi usada, será apagada. Se já tiver histórico de produção, será arquivada e mantida para auditoria.`,
      `Remove recipe “${selectedRecipe.name}”? If it has never been used it will be deleted. If production history exists it will be archived and retained for audit.`,
    ))
    if (!confirmed) return

    setRemoving(true)
    try {
      const { data, error } = await supabase.rpc('remove_recipe', { p_bom_id: selectedRecipe.id })
      if (error) throw error
      const result = (data || {}) as { action?: 'deleted' | 'archived' }
      toast.success(result.action === 'archived'
        ? copy('Receita arquivada porque existe histórico de produção.', 'Recipe archived because production history exists.')
        : copy('Receita apagada.', 'Recipe deleted.'))
      await load()
      window.location.reload()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || copy('Não foi possível remover a receita.', 'Could not remove the recipe.'))
    } finally {
      setRemoving(false)
    }
  }

  async function reverseBuild() {
    if (!selectedBuild || !canReverseBuild || selectedBuild.status !== 'posted') return
    const reason = reverseReason.trim()
    if (!reason) {
      toast.error(copy('Indique o motivo da reversão.', 'Enter a reversal reason.'))
      return
    }

    const item = itemById.get(selectedBuild.product_id)
    const confirmed = window.confirm(copy(
      `Reverter o Quick Assembly ${shortId(selectedBuild.id)}${item?.name ? ` de ${item.name}` : ''}? O produto acabado será retirado do stock e os componentes originais serão repostos.`,
      `Reverse Quick Assembly ${shortId(selectedBuild.id)}${item?.name ? ` for ${item.name}` : ''}? Finished output will be removed from stock and the original components will be restored.`,
    ))
    if (!confirmed) return

    setReversing(true)
    try {
      const { error } = await supabase.rpc('reverse_build', {
        p_build_id: selectedBuild.id,
        p_reason: reason,
        p_request_key: requestKey(),
      })
      if (error) throw error
      toast.success(copy('Quick Assembly revertido.', 'Quick Assembly reversed.'))
      setReverseReason('')
      await load()
      window.location.reload()
    } catch (error: any) {
      console.error(error)
      const message = String(error?.message || '')
      if (message.toLowerCase().includes('insufficient stock')) {
        toast.error(copy(
          'Não é possível reverter porque o produto acabado já não está disponível na localização original em quantidade suficiente.',
          'Cannot reverse because enough finished output is no longer available in the original location.',
        ))
      } else {
        toast.error(message || copy('Não foi possível reverter o Quick Assembly.', 'Could not reverse the Quick Assembly.'))
      }
    } finally {
      setReversing(false)
    }
  }

  if (!companyId) return null

  return (
    <section className="mt-4 grid gap-3 lg:grid-cols-2" aria-label={copy('Controlos de receitas e montagem', 'Recipe and assembly controls')}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {copy('Remover receita', 'Remove recipe')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {copy(
              'Receitas nunca utilizadas podem ser apagadas. Receitas com histórico são arquivadas para preservar a rastreabilidade.',
              'Never-used recipes can be deleted. Recipes with production history are archived to preserve traceability.',
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {recipes.length ? (
            <>
              <div className="space-y-1.5">
                <Label>{copy('Receita', 'Recipe')}</Label>
                <Select value={selectedRecipeId} onValueChange={setSelectedRecipeId} disabled={loading || removing}>
                  <SelectTrigger>
                    <SelectValue placeholder={copy('Seleccione uma receita', 'Select a recipe')} />
                  </SelectTrigger>
                  <SelectContent>
                    {recipes.map((recipe) => {
                      const item = itemById.get(recipe.product_id)
                      return (
                        <SelectItem key={recipe.id} value={recipe.id}>
                          {item?.name || recipe.name} · {recipe.name} {recipe.version ? `· ${recipe.version}` : ''}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
              {selectedRecipe ? (
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant={selectedRecipe.is_active ? 'default' : 'secondary'}>
                    {selectedRecipe.is_active ? copy('Activa', 'Active') : copy('Inactiva', 'Inactive')}
                  </Badge>
                  {!canRemoveRecipe ? (
                    <span className="text-muted-foreground">{copy('Requer Manager ou superior.', 'Manager or above required.')}</span>
                  ) : null}
                </div>
              ) : null}
              <Button variant="destructive" onClick={removeRecipe} disabled={!selectedRecipe || !canRemoveRecipe || removing || loading}>
                {removing ? copy('A remover…', 'Removing…') : copy('Remover receita', 'Remove recipe')}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{copy('Não existem receitas nesta empresa.', 'There are no recipes in this company.')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {copy('Reverter Quick Assembly', 'Reverse Quick Assembly')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {copy(
              'A reversão não apaga o lançamento original. Cria movimentos compensatórios e mantém o histórico.',
              'Reversal does not delete the original posting. It creates compensating movements and preserves history.',
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {builds.length ? (
            <>
              <div className="space-y-1.5">
                <Label>{copy('Montagem recente', 'Recent assembly')}</Label>
                <Select value={selectedBuildId} onValueChange={setSelectedBuildId} disabled={loading || reversing}>
                  <SelectTrigger>
                    <SelectValue placeholder={copy('Seleccione uma montagem', 'Select an assembly')} />
                  </SelectTrigger>
                  <SelectContent>
                    {builds.map((build) => {
                      const item = itemById.get(build.product_id)
                      const recipe = recipeById.get(build.bom_id)
                      const date = new Date(build.created_at).toLocaleDateString(pt ? 'pt-MZ' : 'en-GB')
                      return (
                        <SelectItem key={build.id} value={build.id}>
                          {shortId(build.id)} · {item?.name || recipe?.name || copy('Produto', 'Product')} · {build.qty} · {date}{build.status === 'reversed' ? ` · ${copy('revertida', 'reversed')}` : ''}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              {selectedBuild ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={selectedBuild.status === 'reversed' ? 'secondary' : 'default'}>
                    {selectedBuild.status === 'reversed' ? copy('Revertida', 'Reversed') : copy('Postada', 'Posted')}
                  </Badge>
                  <span className="text-muted-foreground">
                    {itemById.get(selectedBuild.product_id)?.name || copy('Produto acabado', 'Finished item')}
                  </span>
                </div>
              ) : null}

              {selectedBuild?.status === 'posted' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="quick-assembly-reversal-reason">{copy('Motivo da reversão', 'Reversal reason')}</Label>
                  <Input
                    id="quick-assembly-reversal-reason"
                    value={reverseReason}
                    onChange={(event) => setReverseReason(event.target.value)}
                    placeholder={copy('Ex.: quantidade ou destino incorrecto', 'E.g. wrong quantity or destination')}
                    disabled={reversing}
                  />
                </div>
              ) : selectedBuild ? (
                <div className="flex gap-2 rounded-md border border-card-border bg-surface-muted/35 p-3 text-sm text-muted-foreground">
                  <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    {copy('Esta montagem já foi revertida.', 'This assembly has already been reversed.')}
                    {selectedBuild.reversal_reason ? ` ${copy('Motivo:', 'Reason:')} ${selectedBuild.reversal_reason}` : ''}
                  </span>
                </div>
              ) : null}

              <Button
                variant="outline"
                onClick={reverseBuild}
                disabled={!selectedBuild || selectedBuild.status !== 'posted' || !canReverseBuild || reversing || loading}
              >
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                {reversing ? copy('A reverter…', 'Reversing…') : copy('Reverter montagem', 'Reverse assembly')}
              </Button>
              {!canReverseBuild ? (
                <p className="text-xs text-muted-foreground">{copy('A reversão requer Manager ou superior.', 'Reversal requires Manager or above.')}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{copy('Ainda não existem Quick Assemblies nesta empresa.', 'There are no Quick Assemblies in this company yet.')}</p>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
