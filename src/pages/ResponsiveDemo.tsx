// src/pages/ResponsiveDemo.tsx
// Demo page to showcase responsive design features

import { useIsMobile } from '../hooks/use-mobile'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

export default function ResponsiveDemo() {
  const isMobile = useIsMobile()

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-3xl font-bold">Responsive Design Demo</h1>
        <p className="text-muted-foreground">Showcasing mobile-friendly components</p>
      </div>

      {/* Device Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>Device Information</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Current device type: <span className="font-semibold">{isMobile ? 'Mobile' : 'Desktop/Tablet'}</span></p>
          <p className="text-sm text-muted-foreground mt-2">
            Resize your browser window to see how the layout adapts to different screen sizes.
          </p>
        </CardContent>
      </Card>

      {/* Responsive Grid Demo */}
      <Card>
        <CardHeader>
          <CardTitle>Responsive Grid Layout</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 bg-muted rounded-lg">
              <h3 className="font-semibold">Column 1</h3>
              <p className="text-sm">Stacks on mobile, 2 columns on tablet, 3 columns on desktop</p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <h3 className="font-semibold">Column 2</h3>
              <p className="text-sm">Responsive layout adapts to screen size</p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <h3 className="font-semibold">Column 3</h3>
              <p className="text-sm">Touch targets are appropriately sized</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form Demo */}
      <Card>
        <CardHeader>
          <CardTitle>Responsive Form</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input id="firstName" placeholder="Enter first name" className="min-h-[44px]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" placeholder="Enter last name" className="min-h-[44px]" />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="Enter email" className="min-h-[44px]" />
            </div>
            
            <div className="space-y-2">
              <Label>Category</Label>
              <Select>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Category 1</SelectItem>
                  <SelectItem value="2">Category 2</SelectItem>
                  <SelectItem value="3">Category 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <Button type="submit" className="min-h-[44px]">Submit</Button>
              <Button type="button" variant="outline" className="min-h-[44px]">Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Touch Targets Demo */}
      <Card>
        <CardHeader>
          <CardTitle>Touch-Friendly Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-[44px] min-w-[44px]">Button</Button>
            <Button variant="outline" className="min-h-[44px] min-w-[44px]">Outline</Button>
            <Button variant="secondary" className="min-h-[44px] min-w-[44px]">Secondary</Button>
            <Button variant="destructive" className="min-h-[44px] min-w-[44px]">Delete</Button>
          </div>
          
          <div className="mt-4 text-sm text-muted-foreground">
            <p>All buttons have minimum touch target size of 44px × 44px</p>
            <p className="mt-1">This meets WCAG accessibility guidelines for mobile devices.</p>
          </div>
        </CardContent>
      </Card>

      {/* Responsive Typography */}
      <Card>
        <CardHeader>
          <CardTitle>Responsive Typography</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-responsive-sm">Small text (responsive)</p>
            <p className="text-responsive-base">Base text (responsive)</p>
            <p className="text-responsive-lg">Large text (responsive)</p>
            <p className="text-responsive-xl">XL text (responsive)</p>
            <p className="text-responsive-2xl">2XL text (responsive)</p>
            <p className="text-responsive-3xl">3XL text (responsive)</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}