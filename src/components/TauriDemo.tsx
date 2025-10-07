import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { openPath, showOpenDialog, showMessageDialog, isTauriContext } from '@/lib/tauri';

const TauriDemo: React.FC = () => {
  const [filePath, setFilePath] = useState<string>('');
  const [message, setMessage] = useState<string>('Hello from Tauri!');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const handleOpenPath = async () => {
    try {
      await openPath(filePath);
    } catch (error) {
      console.error('Error opening path:', error);
      await showMessageDialog(`Error opening path: ${error}`, { type: 'error' });
    }
  };

  const handleOpenDialog = async () => {
    try {
      const result = await showOpenDialog({
        title: 'Select a file',
        filters: [{
          name: 'All Files',
          extensions: ['*']
        }]
      });
      
      if (result) {
        setSelectedPath(Array.isArray(result) ? result[0] : result);
      }
    } catch (error) {
      console.error('Error opening dialog:', error);
      await showMessageDialog(`Error opening dialog: ${error}`, { type: 'error' });
    }
  };

  const handleShowMessage = async () => {
    try {
      await showMessageDialog(message, { title: 'Tauri Message' });
    } catch (error) {
      console.error('Error showing message:', error);
      await showMessageDialog(`Error showing message: ${error}`, { type: 'error' });
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Tauri Desktop Features Demo</CardTitle>
        <CardDescription>
          This demo shows how to use Tauri APIs in your Stockwise application.
          {isTauriContext() ? ' You are currently running in a Tauri context.' : ' You are currently running in a web browser.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="message">Message to display</Label>
          <Input
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Enter a message"
          />
          <Button onClick={handleShowMessage}>Show Message Dialog</Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="path">Path to open</Label>
          <Input
            id="path"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="Enter a file path or URL"
          />
          <Button onClick={handleOpenPath}>Open Path/URL</Button>
        </div>

        <div className="space-y-2">
          <Label>File Selection</Label>
          <Button onClick={handleOpenDialog}>Open File Dialog</Button>
          {selectedPath && (
            <p className="text-sm text-muted-foreground mt-2">
              Selected: {selectedPath}
            </p>
          )}
        </div>

        <div className="text-sm text-muted-foreground pt-4">
          <h3 className="font-medium mb-2">Tauri Features Available:</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>Native file system access</li>
            <li>System dialog integration</li>
            <li>Desktop notifications</li>
            <li>Menu bar customization</li>
            <li>System tray integration</li>
            <li>Auto-updater capabilities</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

export default TauriDemo;