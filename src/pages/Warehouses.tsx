// src/pages/Warehouses.tsx
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useOrg } from '../hooks/useOrg'

import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Badge } from '../components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '../components/ui/alert-dialog'
import { Warehouse as WarehouseIcon, Plus, Search, Edit, Trash2, MapPin, Package } from 'lucide-react'
import { useI18n } from '../lib/i18n'
import { useIsMobile } from '../hooks/use-mobile'

type Warehouse = {
  id: string
  code: string
  name: string
  address?: string | null
  status: string
  createdAt?: string | null
  updatedAt?: string | null
}

type Bin = {
  id: string                    // text (e.g., "bin_...")
  warehouseId: string           // camelCase in your DB
  code: string
  name: string
  status: string
  createdAt?: string | null     // camelCase in your DB
}

export function Warehouses() {
  const { companyId } = useOrg()
  const { t } = useI18n()
  const isMobile = useIsMobile()

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [bins, setBins] = useState<Bin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isAddBinDialogOpen, setIsAddBinDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Warehouse | null>(null)

  const [form, setForm] = useState({ code: '', name: '', address: '', status: 'active' })
  const [binForm, setBinForm] = useState({ code: '', name: '', warehouseId: '', status: 'active' })

  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        await loadAll()
      } catch (e: any) {
        console.error(e)
        setError(e?.message || t('errors.title'))
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function loadAll() {
    if (!companyId) return

    // Warehouses are snake_case in DB
    const { data: whRaw, error: whErr } = await supabase
      .from('warehouses')
      .select('id,code,name,address,status,created_at,updated_at,company_id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })

    if (whErr) throw whErr

    const whs: Warehouse[] = (whRaw || []).map((w: any) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      address: w.address ?? null,
      status: w.status,
      createdAt: w.created_at ?? null,
      updatedAt: w.updated_at ?? null,
    }))

    setWarehouses(whs)

    // Bins use camelCase columns in your DB (warehouseId, createdAt)
    const whIds = whs.map(w => w.id)
    if (whIds.length === 0) {
      setBins([])
      return
    }

    const { data: bnRaw, error: bnErr } = await supabase
      .from('bins')
      .select('id,warehouseId,code,name,status,createdAt')
      .in('warehouseId', whIds)
      .order('createdAt', { ascending: false })

    if (bnErr) {
      console.error(bnErr)
        toast.error(bnErr.message || t('errors.title'))
      setBins([])
      return
    }

    const bns: Bin[] = (bnRaw || []).map((b: any) => ({
      id: b.id,
      warehouseId: b.warehouseId,
      code: b.code,
      name: b.name,
      status: b.status,
      createdAt: b.createdAt ?? null,
    }))

    setBins(bns)
  }

  function resetForm() {
    setForm({ code: '', name: '', address: '', status: 'active' })
    setEditing(null)
  }
  function resetBinForm() {
    setBinForm({ code: '', name: '', warehouseId: '', status: 'active' })
  }

  async function addWarehouse() {
    try {
      if (!companyId) {
        toast.error(t('org.noCompany'))
        return
      }
      const payload = {
        company_id: companyId,
        code: form.code,
        name: form.name,
        address: form.address || null,
        status: form.status,
      }
      const { data, error } = await supabase
        .from('warehouses')
        .insert(payload)
        .select('id,code,name,address,status,created_at,updated_at')
        .single()

      if (error) throw error

      setWarehouses(prev => [
        {
          id: data!.id,
          code: data!.code,
          name: data!.name,
          address: data!.address ?? null,
          status: data!.status,
          createdAt: data!.created_at ?? null,
          updatedAt: data!.updated_at ?? null,
        },
        ...prev,
      ])

      setIsAddDialogOpen(false)
      resetForm()
      toast.success(t('warehouses.added') ?? 'Warehouse added')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || t('errors.title'))
    }
  }

  async function updateWarehouse() {
    if (!editing) return
    try {
      const patch = {
        code: form.code,
        name: form.name,
        address: form.address || null,
        status: form.status,
      }
      const { data, error } = await supabase
        .from('warehouses')
        .update(patch)
        .eq('id', editing.id)
        .select('id,code,name,address,status,created_at,updated_at')
        .single()

      if (error) throw error

      setWarehouses(prev =>
        prev.map(x =>
          x.id === editing.id
            ? {
                id: data!.id,
                code: data!.code,
                name: data!.name,
                address: data!.address ?? null,
                status: data!.status,
                createdAt: data!.created_at ?? null,
                updatedAt: data!.updated_at ?? null,
              }
            : x
        )
      )

      setEditing(null)
      resetForm()
      toast.success(t('warehouses.updated') ?? 'Warehouse updated')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || t('errors.title'))
    }
  }

  async function deleteWarehouse(id: string) {
    try {
      // Stock-level check (snake_case)
      const { count, error: slErr } = await supabase
        .from('stock_levels')
        .select('id', { head: true, count: 'exact' })
        .eq('warehouse_id', id)

      if (slErr) {
        console.warn('Stock-level check failed; aborting delete:', slErr)
        toast.error(t('warehouses.cannotVerify') ?? 'Could not verify stock levels; aborting delete')
        return
      }
      if ((count ?? 0) > 0) {
        toast.error(t('warehouses.cannotDeleteHasStock') ?? 'Cannot delete warehouse with existing stock')
        return
      }

      // Delete the warehouse; bins should be removed by FK CASCADE if configured.
      const { error: delErr } = await supabase.from('warehouses').delete().eq('id', id)
      if (delErr) throw delErr

      setWarehouses(prev => prev.filter(wh => wh.id !== id))
      setBins(prev => prev.filter(b => b.warehouseId !== id))
      toast.success(t('warehouses.deleted') ?? 'Warehouse deleted')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || t('errors.title'))
    }
  }

  async function addBin() {
    try {
      if (!binForm.warehouseId) {
        toast.error(t('warehouses.selectFirst') ?? 'Select a warehouse first')
        return
      }
      const payload = {
        id: `bin_${Date.now()}`, // bins.id is TEXT
        warehouseId: binForm.warehouseId, // camelCase column
        code: binForm.code,
        name: binForm.name,
        status: binForm.status,
      }
      const { data, error } = await supabase
        .from('bins')
        .insert(payload)
        .select('id,warehouseId,code,name,status,createdAt')
        .single()

      if (error) throw error

      setBins(prev => [
        {
          id: data!.id,
          warehouseId: data!.warehouseId,
          code: data!.code,
          name: data!.name,
          status: data!.status,
          createdAt: data!.createdAt ?? null,
        },
        ...prev,
      ])
      setIsAddBinDialogOpen(false)
      resetBinForm()
      toast.success(t('warehouses.binAdded') ?? 'Bin added')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || t('errors.title'))
    }
  }

  const filtered = warehouses.filter(w =>
    w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    w.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (w.address ?? '').toLowerCase().includes(searchTerm.toLowerCase())
  )

  const binsFor = (warehouseId: string) => bins.filter(b => b.warehouseId === warehouseId)

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">{t('nav.warehouses')}</h1>
        </div>
        <div className="animate-pulse">
          <div className="h-10 bg-muted rounded mb-4"></div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold mb-2">{t('errors.title')}</h2>
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button onClick={() => location.reload()}>{t('common.retry')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 mobile-container w-full max-w-full overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('nav.warehouses')}</h1>
          <p className="text-muted-foreground">{t('warehouses.subtitle') ?? ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={isAddBinDialogOpen} onOpenChange={setIsAddBinDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" onClick={resetBinForm} className={isMobile ? 'px-2' : ''}>
                <Package className="w-4 h-4 mr-2" />
                {t('warehouses.addBin') ?? 'Add Bin'}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t('warehouses.addBin')}</DialogTitle>
                <DialogDescription>{t('warehouses.addBinDesc') ?? ''}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>{t('warehouses.warehouse')}</Label>
                  <Select
                    value={binForm.warehouseId}
                    onValueChange={(v) => setBinForm(s => ({ ...s, warehouseId: v }))}
                  >
                    <SelectTrigger><SelectValue placeholder={t('orders.selectWarehouse')} /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map(wh => (
                        <SelectItem key={wh.id} value={wh.id}>
                          {wh.name} ({wh.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t('warehouses.binCode') ?? 'Bin Code'}</Label>
                  <Input
                    value={binForm.code}
                    onChange={e => setBinForm(s => ({ ...s, code: e.target.value }))}
                    placeholder="A1-01"
                  />
                </div>
                <div>
                  <Label>{t('warehouses.binName') ?? 'Bin Name'}</Label>
                  <Input
                    value={binForm.name}
                    onChange={e => setBinForm(s => ({ ...s, name: e.target.value }))}
                    placeholder="Shelf A1 Bin 01"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsAddBinDialogOpen(false)}>{t('common.cancel') ?? 'Cancel'}</Button>
                  <Button onClick={addBin}>{t('warehouses.addBin') ?? 'Add Bin'}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={resetForm} className={isMobile ? 'px-2' : ''}>
                <Plus className="w-4 h-4 mr-2" />
                {t('warehouses.addWarehouse') ?? 'Add Warehouse'}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t('warehouses.addWarehouse')}</DialogTitle>
                <DialogDescription>{t('warehouses.addWarehouseDesc') ?? ''}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>{t('users.code') ?? 'Code'}</Label>
                  <Input
                    value={form.code}
                    onChange={e => setForm(s => ({ ...s, code: e.target.value }))}
                    placeholder="WH001"
                  />
                </div>
                <div>
                  <Label>{t('items.fields.name')}</Label>
                  <Input
                    value={form.name}
                    onChange={e => setForm(s => ({ ...s, name: e.target.value }))}
                    placeholder="Main Warehouse"
                  />
                </div>
                <div>
                  <Label>{t('settings.companyProfile.address1')}</Label>
                  <Input
                    value={form.address}
                    onChange={e => setForm(s => ({ ...s, address: e.target.value }))}
                    placeholder="Address"
                  />
                </div>
                <div>
                  <Label>{t('orders.status')}</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) => setForm(s => ({ ...s, status: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">{t('suppliers.active')}</SelectItem>
                      <SelectItem value="inactive">{t('suppliers.inactive')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>{t('common.cancel') ?? 'Cancel'}</Button>
                  <Button onClick={addWarehouse}>{t('warehouses.addWarehouse') ?? 'Add Warehouse'}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t('warehouses.search') ?? 'Search by name, code, or address...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WarehouseIcon className="w-5 h-5" />
            <span>{t('nav.warehouses')} ({filtered.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length > 0 ? (
            <div className="space-y-4">
              {filtered.map(wh => {
                const wBins = binsFor(wh.id)
                return (
                  <div key={wh.id} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                          <WarehouseIcon className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-medium">{wh.name}</h3>
                          <p className="text-sm text-muted-foreground">{t('users.code') ?? 'Code'}: {wh.code}</p>
                          {wh.address && (
                            <p className="text-xs text-muted-foreground flex items-center mt-1">
                              <MapPin className="w-3 h-3 mr-1" />
                              {wh.address}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm"><span className="text-muted-foreground">{t('warehouses.bins') ?? 'Bins'}:</span> {wBins.length}</p>
                        </div>
                        <Badge variant={wh.status === 'active' ? 'default' : 'secondary'}>{wh.status}</Badge>
                        <div className="flex items-center gap-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditing(wh)
                                  setForm({
                                    code: wh.code,
                                    name: wh.name,
                                    address: wh.address ?? '',
                                    status: wh.status,
                                  })
                                }}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md">
                              <DialogHeader>
                                <DialogTitle>{t('warehouses.edit') ?? 'Edit Warehouse'}</DialogTitle>
                                <DialogDescription>{t('warehouses.editDesc') ?? 'Update details'}</DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div><Label>{t('users.code') ?? 'Code'}</Label><Input value={form.code} onChange={e => setForm(s => ({ ...s, code: e.target.value }))} /></div>
                                <div><Label>{t('items.fields.name')}</Label><Input value={form.name} onChange={e => setForm(s => ({ ...s, name: e.target.value }))} /></div>
                                <div><Label>{t('settings.companyProfile.address1')}</Label><Input value={form.address} onChange={e => setForm(s => ({ ...s, address: e.target.value }))} /></div>
                                <div>
                                  <Label>Status</Label>
                                  <Select value={form.status} onValueChange={(v) => setForm(s => ({ ...s, status: v }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="active">{t('suppliers.active')}</SelectItem>
                                      <SelectItem value="inactive">{t('suppliers.inactive')}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex justify-end gap-2">
                                  <Button variant="outline" onClick={() => setEditing(null)}>{t('common.cancel') ?? 'Cancel'}</Button>
                                  <Button onClick={updateWarehouse}>{t('warehouses.updateWarehouse') ?? 'Update Warehouse'}</Button>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t('warehouses.delete') ?? 'Delete Warehouse'}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t('warehouses.deleteDesc') ?? 'This will also delete all associated bins.'}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t('common.cancel') ?? 'Cancel'}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteWarehouse(wh.id)}>{t('common.remove')}</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </div>

                    {wBins.length > 0 && (
                      <div className="mt-4 pt-4 border-t">
                        <p className="text-sm font-medium mb-2">{t('warehouses.binLocations') ?? 'Bin Locations:'}</p>
                        <div className="flex flex-wrap gap-2">
                          {wBins.map(b => (
                            <Badge key={b.id} variant="outline" className="text-xs">
                              {b.code}: {b.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <WarehouseIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">{t('warehouses.none') ?? 'No warehouses found'}</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm ? (t('warehouses.searchAdjust') ?? 'Try adjusting your search terms') : (t('warehouses.getStarted') ?? 'Get started by adding your first warehouse')}
              </p>
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button onClick={resetForm}>
                    <Plus className="w-4 h-4 mr-2" />
                    {t('warehouses.addWarehouse') ?? 'Add Warehouse'}
                  </Button>
                </DialogTrigger>
              </Dialog>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default Warehouses
