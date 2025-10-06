// src/components/ui/responsive-test.tsx
// Component to test responsive design improvements

import { useIsMobile } from '../../hooks/use-mobile'
import { Card, CardContent, CardHeader, CardTitle } from './card'
import { Button } from './button'

export function ResponsiveTest() {
  const isMobile = useIsMobile()

  return (
    <Card className="m-4">
      <CardHeader>
        <CardTitle>Responsive Design Test</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p>Current device: {isMobile ? 'Mobile' : 'Desktop/Tablet'}</p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <Button className="touch-target">Touch Button 1</Button>
            <Button className="touch-target">Touch Button 2</Button>
            <Button className="touch-target">Touch Button 3</Button>
          </div>
          
          <div className="mobile-grid tablet-grid desktop-grid">
            <div className="p-4 bg-muted rounded-lg">Grid Item 1</div>
            <div className="p-4 bg-muted rounded-lg">Grid Item 2</div>
            <div className="p-4 bg-muted rounded-lg">Grid Item 3</div>
          </div>
          
          <p className="text-responsive-sm">Small responsive text</p>
          <p className="text-responsive-base">Base responsive text</p>
          <p className="text-responsive-lg">Large responsive text</p>
          <p className="text-responsive-xl">XL responsive text</p>
          <p className="text-responsive-2xl">2XL responsive text</p>
          <p className="text-responsive-3xl">3XL responsive text</p>
        </div>
      </CardContent>
    </Card>
  )
}