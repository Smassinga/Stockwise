// src/pages/Warehouses.tsx
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { db } from '../lib/db'
import { supabase } from '../lib/supabase' // NEW: use Supabase directly for stock check & delete

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
  id: string
  warehouseId: string
  code: string
  name: string
  status: string
  createdAt?: string | null
}

export function Warehouses() {
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
    (async () => {
      try {
        setLoading(true)
        setError(null)

        const [wh, bn] = await Promise.all([
          db.warehouses.list({ orderBy: { createdAt: 'desc' } }),
          db.bins.list({ orderBy: { createdAt: 'desc' } }),
        ])

        setWarehouses(Array.isArray(wh) ? wh : [])
        setBins(Array.isArray(bn) ? bn : [])
      } catch (e: any) {
        console.error(e)
        setError(e?.message || 'Failed to load warehouses')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  function resetForm() {
    setForm({ code: '', name: '', address: '', status: 'active' })
    setEditing(null)
  }
  function resetBinForm() {
    setBinForm({ code: '', name: '', warehouseId: '', status: 'active' })
  }

  async function addWarehouse() {
    try {
      const w = await db.warehouses.create({
        code: form.code,
        name: form.name,
        address: form.address || null,
        status: form.status,
      })
      setWarehouses(prev => [w, ...prev])
      setIsAddDialogOpen(false)
      resetForm()
      toast.success('Warehouse added')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to add warehouse')
    }
  }

  async function updateWarehouse() {
    if (!editing) return
    try {
      const w = await db.warehouses.update(editing.id, {
        code: form.code,
        name: form.name,
        address: form.address || null,
        status: form.status,
      })
      setWarehouses(prev => prev.map(x => (x.id === editing.id ? { ...x, ...w } : x)))
      setEditing(null)
      resetForm()
      toast.success('Warehouse updated')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to update warehouse')
    }
  }

  async function deleteWarehouse(id: string) {
    try {
      // ✅ Correct stock check using snake_case column
      const { count, error: slErr } = await supabase
        .from('stock_levels')
        .select('id', { head: true, count: 'exact' })
        .eq('warehouse_id', id)

      if (slErr) {
        console.warn('Stock-level check failed; aborting delete:', slErr)
        toast.error('Could not verify stock levels; aborting delete')
        return
      }
      if ((count ?? 0) > 0) {
        toast.error('Cannot delete warehouse with existing stock')
        return
      }

      // ✅ Delete the warehouse (FK ON DELETE CASCADE should remove bins)
      const { error: delErr } = await supabase.from('warehouses').delete().eq('id', id)
      if (delErr) throw delErr

      setWarehouses(prev => prev.filter(w => w.id !== id))
      setBins(prev => prev.filter(b => b.warehouseId !== id))
      toast.success('Warehouse deleted')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to delete warehouse')
    }
  }

  async function addBin() {
    try {
      if (!binForm.warehouseId) {
        toast.error('Select a warehouse first')
        return
      }
      const bn = await db.bins.create({
        id: `bin_${Date.now()}`, // bins.id is text
        warehouseId: binForm.warehouseId,
        code: binForm.code,
        name: binForm.name,
        status: binForm.status,
      })
      setBins(prev => [bn, ...prev])
      setIsAddBinDialogOpen(false)
      resetBinForm()
      toast.success('Bin added')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to add bin')
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
          <h1 className="text-3xl font-bold">Warehouses</h1>
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
        <h2 className="text-xl font-bold mb-2">Warehouses Error</h2>
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button onClick={() => location.reload()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Warehouses</h1>
          <p className="text-muted-foreground">Manage warehouse locations and bin storage</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isAddBinDialogOpen} onOpenChange={setIsAddBinDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" onClick={resetBinForm}>
                <Package className="w-4 h-4 mr-2" />
                Add Bin
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add Bin Location</DialogTitle>
                <DialogDescription>Create a new storage bin</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Warehouse</Label>
                  <Select
                    value={binForm.warehouseId}
                    onValueChange={(v) => setBinForm(s => ({ ...s, warehouseId: v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map(w => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name} ({w.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Bin Code</Label>
                  <Input
                    value={binForm.code}
                    onChange={e => setBinForm(s => ({ ...s, code: e.target.value }))}
                    placeholder="A1-01"
                  />
                </div>
                <div>
                  <Label>Bin Name</Label>
                  <Input
                    value={binForm.name}
                    onChange={e => setBinForm(s => ({ ...s, name: e.target.value }))}
                    placeholder="Shelf A1 Bin 01"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsAddBinDialogOpen(false)}>Cancel</Button>
                  <Button onClick={addBin}>Add Bin</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={resetForm}>
                <Plus className="w-4 h-4 mr-2" />
                Add Warehouse
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add New Warehouse</DialogTitle>
                <DialogDescription>Set up a new warehouse</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Code</Label>
                  <Input
                    value={form.code}
                    onChange={e => setForm(s => ({ ...s, code: e.target.value }))}
                    placeholder="WH001"
                  />
                </div>
                <div>
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={e => setForm(s => ({ ...s, name: e.target.value }))}
                    placeholder="Main Warehouse"
                  />
                </div>
                <div>
                  <Label>Address</Label>
                  <Input
                    value={form.address}
                    onChange={e => setForm(s => ({ ...s, address: e.target.value }))}
                    placeholder="Address"
                  />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) => setForm(s => ({ ...s, status: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
                  <Button onClick={addWarehouse}>Add Warehouse</Button>
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
            placeholder="Search by name, code, or address..."
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
            <span>Warehouses ({filtered.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length > 0 ? (
            <div className="space-y-4">
              {filtered.map(w => {
                const wBins = binsFor(w.id)
                return (
                  <div key={w.id} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                          <WarehouseIcon className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-medium">{w.name}</h3>
                          <p className="text-sm text-muted-foreground">Code: {w.code}</p>
                          {w.address && (
                            <p className="text-xs text-muted-foreground flex items-center mt-1">
                              <MapPin className="w-3 h-3 mr-1" />
                              {w.address}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm"><span className="text-muted-foreground">Bins:</span> {wBins.length}</p>
                        </div>
                        <Badge variant={w.status === 'active' ? 'default' : 'secondary'}>{w.status}</Badge>
                        <div className="flex items-center gap-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditing(w)
                                  setForm({
                                    code: w.code,
                                    name: w.name,
                                    address: w.address ?? '',
                                    status: w.status,
                                  })
                                }}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md">
                              <DialogHeader>
                                <DialogTitle>Edit Warehouse</DialogTitle>
                                <DialogDescription>Update details</DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div><Label>Code</Label><Input value={form.code} onChange={e => setForm(s => ({ ...s, code: e.target.value }))} /></div>
                                <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(s => ({ ...s, name: e.target.value }))} /></div>
                                <div><Label>Address</Label><Input value={form.address} onChange={e => setForm(s => ({ ...s, address: e.target.value }))} /></div>
                                <div>
                                  <Label>Status</Label>
                                  <Select value={form.status} onValueChange={(v) => setForm(s => ({ ...s, status: v }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="active">Active</SelectItem>
                                      <SelectItem value="inactive">Inactive</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex justify-end gap-2">
                                  <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                                  <Button onClick={updateWarehouse}>Update Warehouse</Button>
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
                                <AlertDialogTitle>Delete Warehouse</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will also delete all associated bins.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteWarehouse(w.id)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </div>

                    {wBins.length > 0 && (
                      <div className="mt-4 pt-4 border-t">
                        <p className="text-sm font-medium mb-2">Bin Locations:</p>
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
              <h3 className="text-lg font-medium mb-2">No warehouses found</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm ? 'Try adjusting your search terms' : 'Get started by adding your first warehouse'}
              </p>
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button onClick={resetForm}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Warehouse
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
