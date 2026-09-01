import type { Dispatch, SetStateAction } from 'react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import type { AssemblyTimeUnit } from '../../lib/assemblyPlanning'

type Translate = (key: string, vars?: Record<string, string | number>) => string
type RecipeView = 'register' | 'create' | 'detail' | 'build'
type RecipeItem = { id: string; name: string }

type BomRecipeCreateFormProps = {
  view: RecipeView
  tt: (key: string, fallback: string, vars?: Record<string, string | number>) => string
  t: Translate
  items: RecipeItem[]
  newBomProductId: string
  setNewBomProductId: Dispatch<SetStateAction<string>>
  newBomName: string
  setNewBomName: Dispatch<SetStateAction<string>>
  newAssemblyTimeValue: string
  setNewAssemblyTimeValue: Dispatch<SetStateAction<string>>
  newAssemblyTimeUnit: AssemblyTimeUnit
  setNewAssemblyTimeUnit: Dispatch<SetStateAction<AssemblyTimeUnit>>
  newSetupTimeValue: string
  setNewSetupTimeValue: Dispatch<SetStateAction<string>>
  newSetupTimeUnit: AssemblyTimeUnit
  setNewSetupTimeUnit: Dispatch<SetStateAction<AssemblyTimeUnit>>
  canManageBom: boolean
  createBomForProduct: () => unknown | Promise<unknown>
}

export function BomRecipeCreateForm({
  view,
  tt,
  t,
  items,
  newBomProductId,
  setNewBomProductId,
  newBomName,
  setNewBomName,
  newAssemblyTimeValue,
  setNewAssemblyTimeValue,
  newAssemblyTimeUnit,
  setNewAssemblyTimeUnit,
  newSetupTimeValue,
  setNewSetupTimeValue,
  newSetupTimeUnit,
  setNewSetupTimeUnit,
  canManageBom,
  createBomForProduct,
}: BomRecipeCreateFormProps) {
  return (
    <>
      {/* Recipe creation */}
      {view === 'create' ? (
      <Card id="recipe-create">
        <CardHeader>
          <CardTitle>{tt('bom.recipeCreateTitle', 'Create an assembly recipe')}</CardTitle>
          <CardDescription>
            {tt('bom.recipeCreateHelp', 'Use this when a finished product does not yet have a BOM. Recipe setup is separate from posting the build itself.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4 md:grid-cols-6">
          <div className="min-w-0 md:col-span-2">
            <Label>{t('orders.item')}</Label>
            <Select value={newBomProductId} onValueChange={setNewBomProductId}>
              <SelectTrigger><SelectValue placeholder={tt('bom.recipeCreatePlaceholder', 'Select the finished product')} /></SelectTrigger>
              <SelectContent className="max-h-64 overflow-auto">
                {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="text-[11px] text-muted-foreground mt-1">
              {tt('bom.recipeCreateHint', 'Pick the exact item you will stock as the finished output.')}
            </div>
          </div>
          <div className="min-w-0 md:col-span-2">
            <Label>{t('items.fields.name')}</Label>
            <Input value={newBomName} onChange={e => setNewBomName(e.target.value)} placeholder={tt('bom.recipeCreateNamePlaceholder', 'e.g. Sweet Bread v1')} />
            <div className="text-[11px] text-muted-foreground mt-1">
              {tt('bom.recipeCreateVersionHint', 'Include a version in the recipe name so later revisions stay traceable.')}
            </div>
          </div>
          <div className="grid min-w-0 gap-3 rounded-2xl border border-border/70 bg-muted/15 p-4 md:col-span-2">
            <div className="text-sm font-medium">{tt('bom.time.configTitle', 'Time planning')}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-bom-time-per-unit">{tt('bom.time.perUnitLabel', 'Time per unit')}</Label>
                <Input
                  id="new-bom-time-per-unit"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={newAssemblyTimeValue}
                  onChange={e => setNewAssemblyTimeValue(e.target.value)}
                  placeholder={tt('bom.time.perUnitPlaceholder', 'Optional')}
                />
              </div>
              <div className="space-y-2">
                <Label>{tt('bom.time.unitLabel', 'Time unit')}</Label>
                <Select value={newAssemblyTimeUnit} onValueChange={(value) => setNewAssemblyTimeUnit(value as AssemblyTimeUnit)}>
                  <SelectTrigger><SelectValue placeholder={tt('bom.time.unitLabel', 'Time unit')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">{tt('bom.time.unit.minutes', 'Minutes')}</SelectItem>
                    <SelectItem value="hours">{tt('bom.time.unit.hours', 'Hours')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-bom-setup-time">{tt('bom.time.setupLabel', 'Setup time per batch')}</Label>
                <Input
                  id="new-bom-setup-time"
                  type="number"
                  min="0"
                  step="0.01"
                  value={newSetupTimeValue}
                  onChange={e => setNewSetupTimeValue(e.target.value)}
                  placeholder={tt('bom.time.setupPlaceholder', 'Optional')}
                />
              </div>
              <div className="space-y-2">
                <Label>{tt('bom.time.setupUnitLabel', 'Setup unit')}</Label>
                <Select value={newSetupTimeUnit} onValueChange={(value) => setNewSetupTimeUnit(value as AssemblyTimeUnit)}>
                  <SelectTrigger><SelectValue placeholder={tt('bom.time.setupUnitLabel', 'Setup unit')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">{tt('bom.time.unit.minutes', 'Minutes')}</SelectItem>
                    <SelectItem value="hours">{tt('bom.time.unit.hours', 'Hours')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {tt('bom.time.configHelp', 'Leave time blank when the recipe can be built but no reliable planning estimate exists yet.')}
            </div>
          </div>
          <div className="md:col-span-6 flex justify-end">
            <Button onClick={createBomForProduct} disabled={!canManageBom || !newBomProductId || !newBomName.trim()}>
              {tt('bom.recipeCreateAction', 'Create recipe')}
            </Button>
          </div>
        </CardContent>
      </Card>
      ) : null}


    </>
  )
}
