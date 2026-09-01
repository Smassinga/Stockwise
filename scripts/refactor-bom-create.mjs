import fs from 'node:fs'

const pagePath = 'src/pages/BOM.tsx'
const componentPath = 'src/features/bom/BomRecipeCreateForm.tsx'
let source = fs.readFileSync(pagePath, 'utf8')

const componentImport = "import { BomRecipeCreateForm } from '../features/bom/BomRecipeCreateForm'\n"
const importAnchor = "import { BomRecipeRegister } from '../features/bom/BomRecipeRegister'\n"
if (!source.includes(componentImport)) {
  if (!source.includes(importAnchor)) throw new Error('BOM register import anchor not found')
  source = source.replace(importAnchor, `${importAnchor}${componentImport}`)
}

const start = "      {/* Recipe creation */}\n      {view === 'create' ? ("
const next = "      {/* Pick + Edit existing BOM */}"
const startIndex = source.indexOf(start)
const nextIndex = source.indexOf(next, startIndex)
if (startIndex < 0 || nextIndex < 0 || nextIndex <= startIndex) throw new Error('BOM create-form boundaries not found')
const block = source.slice(startIndex, nextIndex)
if (!block.trimEnd().endsWith(') : null}')) throw new Error('BOM create-form block did not end at expected conditional boundary')

const component = `import type { Dispatch, SetStateAction } from 'react'\nimport { Button } from '../../components/ui/button'\nimport { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'\nimport { Input } from '../../components/ui/input'\nimport { Label } from '../../components/ui/label'\nimport { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'\nimport type { AssemblyTimeUnit } from '../../lib/assemblyPlanning'\n\ntype Translate = (key: string, fallback?: string, vars?: Record<string, string | number>) => string\ntype RecipeView = 'register' | 'create' | 'detail' | 'build'\ntype RecipeItem = { id: string; name: string }\n\ntype BomRecipeCreateFormProps = {\n  view: RecipeView\n  tt: (key: string, fallback: string, vars?: Record<string, string | number>) => string\n  t: Translate\n  items: RecipeItem[]\n  newBomProductId: string\n  setNewBomProductId: Dispatch<SetStateAction<string>>\n  newBomName: string\n  setNewBomName: Dispatch<SetStateAction<string>>\n  newAssemblyTimeValue: string\n  setNewAssemblyTimeValue: Dispatch<SetStateAction<string>>\n  newAssemblyTimeUnit: AssemblyTimeUnit\n  setNewAssemblyTimeUnit: Dispatch<SetStateAction<AssemblyTimeUnit>>\n  newSetupTimeValue: string\n  setNewSetupTimeValue: Dispatch<SetStateAction<string>>\n  newSetupTimeUnit: AssemblyTimeUnit\n  setNewSetupTimeUnit: Dispatch<SetStateAction<AssemblyTimeUnit>>\n  canManageBom: boolean\n  createBomForProduct: () => void | Promise<void>\n}\n\nexport function BomRecipeCreateForm({\n  view,\n  tt,\n  t,\n  items,\n  newBomProductId,\n  setNewBomProductId,\n  newBomName,\n  setNewBomName,\n  newAssemblyTimeValue,\n  setNewAssemblyTimeValue,\n  newAssemblyTimeUnit,\n  setNewAssemblyTimeUnit,\n  newSetupTimeValue,\n  setNewSetupTimeValue,\n  newSetupTimeUnit,\n  setNewSetupTimeUnit,\n  canManageBom,\n  createBomForProduct,\n}: BomRecipeCreateFormProps) {\n  return (\n    <>\n${block}\n    </>\n  )\n}\n`
fs.mkdirSync('src/features/bom', { recursive: true })
fs.writeFileSync(componentPath, component)

const replacement = `      <BomRecipeCreateForm\n        view={view}\n        tt={tt}\n        t={t}\n        items={items}\n        newBomProductId={newBomProductId}\n        setNewBomProductId={setNewBomProductId}\n        newBomName={newBomName}\n        setNewBomName={setNewBomName}\n        newAssemblyTimeValue={newAssemblyTimeValue}\n        setNewAssemblyTimeValue={setNewAssemblyTimeValue}\n        newAssemblyTimeUnit={newAssemblyTimeUnit}\n        setNewAssemblyTimeUnit={setNewAssemblyTimeUnit}\n        newSetupTimeValue={newSetupTimeValue}\n        setNewSetupTimeValue={setNewSetupTimeValue}\n        newSetupTimeUnit={newSetupTimeUnit}\n        setNewSetupTimeUnit={setNewSetupTimeUnit}\n        canManageBom={canManageBom}\n        createBomForProduct={createBomForProduct}\n      />\n\n`
source = `${source.slice(0, startIndex)}${replacement}${source.slice(nextIndex)}`
fs.writeFileSync(pagePath, source)
console.log('Extracted BOM recipe create form component')
