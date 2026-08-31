from pathlib import Path

files = {
    'sales': Path('src/pages/SalesInvoiceDetail.tsx'),
    'vendor': Path('src/pages/VendorBillDetail.tsx'),
}

import_anchor = "import FinanceTimelineCard from '../components/finance/FinanceTimelineCard'\n"
import_replacement = import_anchor + "import FinanceRawEventRegistryCard from '../components/finance/FinanceRawEventRegistryCard'\n"

start_markers = {
    'sales': "            <Card className=\"border-border/80 shadow-sm\">\n              <CardHeader>\n                <CardTitle>{tt('financeDocs.audit.rawTitle', 'Raw event registry')}</CardTitle>",
    'vendor': "          <Card className=\"border-border/80 shadow-sm\">\n            <CardHeader>\n              <CardTitle>{tt('financeDocs.audit.rawTitle', 'Raw event registry')}</CardTitle>",
}

replacements = {
    'sales': """            <FinanceRawEventRegistryCard
              events={events}
              translate={(key, fallback) => tt(key, fallback)}
              transitionStyle="unicode"
            />""",
    'vendor': """          <FinanceRawEventRegistryCard
            events={events}
            translate={(key, fallback) => tt(key, fallback)}
            transitionStyle="ascii"
          />""",
}

for key, path in files.items():
    text = path.read_text()

    if text.count(import_anchor) != 1:
        raise SystemExit(f'{path}: expected one FinanceTimelineCard import, found {text.count(import_anchor)}')
    text = text.replace(import_anchor, import_replacement, 1)

    if text.count("financeDocs.audit.rawTitle") != 1:
        raise SystemExit(f'{path}: expected one raw event registry title, found {text.count("financeDocs.audit.rawTitle")}')

    start = text.find(start_markers[key])
    if start < 0:
        raise SystemExit(f'{path}: raw event registry start not found')

    if key == 'sales':
        end_marker = "\n\n            <Card className=\"border-border/80 shadow-sm\">\n              <CardHeader>\n                <CardTitle>{tt('financeDocs.mz.archiveTitle', 'Archive and artifacts')}</CardTitle>"
    else:
        end_marker = "\n\n          <Dialog open={creditDialogOpen} onOpenChange={setCreditDialogOpen}>"

    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'{path}: raw event registry end boundary not found')

    old_block = text[start:end]
    if "events.map((event)" not in old_block or "event.occurred_at.replace('T', ' ').slice(0, 19)" not in old_block:
        raise SystemExit(f'{path}: raw event registry guard content mismatch')

    text = text[:start] + replacements[key] + text[end:]
    path.write_text(text)
