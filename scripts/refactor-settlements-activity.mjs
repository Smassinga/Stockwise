import fs from 'node:fs'

const path = 'src/pages/Settlements.tsx'
let source = fs.readFileSync(path, 'utf8')

const importAnchor = "} from '../features/settlements/settlementModel'\n"
const componentImport = "import { SettlementActivityWorkspace } from '../features/settlements/SettlementActivityWorkspace'\n"
if (!source.includes(componentImport)) {
  if (!source.includes(importAnchor)) throw new Error('Settlement model import anchor not found')
  source = source.replace(importAnchor, `${importAnchor}${componentImport}`)
}

source = source.replace(
  "import { Download, FileWarning, ReceiptText, Undo2 } from 'lucide-react'",
  "import { Download, ReceiptText, Undo2 } from 'lucide-react'",
)
source = source.replace("import { Badge } from '../components/ui/badge'\n", '')

const start = '        <TabsContent value="activity" className="mt-0 space-y-6">'
const end = '        <TabsContent value="reconciliation" className="mt-0 space-y-6">'
const startIndex = source.indexOf(start)
const endIndex = source.indexOf(end)
if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
  throw new Error('Activity workspace boundaries not found')
}

const replacement = `        <SettlementActivityWorkspace
          tt={tt}
          workspaceSide={workspaceSide}
          activityLoading={activityLoading}
          activityError={activityError}
          filteredActivityRows={filteredActivityRows}
          activityTotal={activityTotal}
          activityFrom={activityFrom}
          activityTo={activityTo}
          activitySearch={activitySearch}
          activityMethod={activityMethod}
          money={money}
          activityAnchorKindLabel={activityAnchorKindLabel}
          onWorkspaceSideChange={(side) => updateWorkspaceQuery({ side })}
          onActivitySearchChange={setActivitySearch}
          onActivityFromChange={setActivityFrom}
          onActivityToChange={setActivityTo}
          onActivityMethodChange={setActivityMethod}
          onExportActivity={() => setExportRequest({ kind: 'activity' })}
          onExportAdvice={(activity) => setExportRequest({ kind: 'advice', activity })}
          onViewAnchor={(row) => {
            if (row.anchorKind) viewReconciliationAnchor(row.anchorKind, row.anchorId || row.refId)
          }}
        />

`

source = `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex)}`
fs.writeFileSync(path, source)
console.log('Extracted Settlements activity workspace component')
