import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { openPath, showOpenDialog, showMessageDialog, isTauriContext } from '@/lib/tauri';
import { useI18n } from '@/lib/i18n';

const TauriDemo: React.FC = () => {
  const { t } = useI18n();
  const [filePath, setFilePath] = useState<string>('');
  const [message, setMessage] = useState<string>('Hello from Tauri!');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const handleOpenPath = async () => {
    try {
      await openPath(filePath);
    } catch (error) {
      console.error('Error opening path:', error);
      await showMessageDialog(`${t('common.headsUp')}: ${error}`, { type: 'error' });
    }
  };

  const handleOpenDialog = async () => {
    try {
      const result = await showOpenDialog({
        title: t('tauri.demo.fileSelection'),
        filters: [{
          name: t('common.all'),
          extensions: ['*']
        }]
      });
      
      if (result) {
        setSelectedPath(Array.isArray(result) ? result[0] : result);
      }
    } catch (error) {
      console.error('Error opening dialog:', error);
      await showMessageDialog(`${t('common.headsUp')}: ${error}`, { type: 'error' });
    }
  };

  const handleShowMessage = async () => {
    try {
      await showMessageDialog(message, { title: t('tauri.demo.showMessageDialog') });
    } catch (error) {
      console.error('Error showing message:', error);
      await showMessageDialog(`${t('common.headsUp')}: ${error}`, { type: 'error' });
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>{t('tauri.demo.title')}</CardTitle>
        <CardDescription>
          {t('tauri.demo.featuresAvailable')} {isTauriContext() ? t('tauri.demo.features.systemDialog') : t('common.headsUp')}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="message">{t('tauri.demo.messageToDisplay')}</Label>
          <Input
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('tauri.demo.messageToDisplay')}
          />
          <Button onClick={handleShowMessage}>{t('tauri.demo.showMessageDialog')}</Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="path">{t('tauri.demo.pathToOpen')}</Label>
          <Input
            id="path"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder={t('tauri.demo.pathToOpen')}
          />
          <Button onClick={handleOpenPath}>{t('tauri.demo.openPathUrl')}</Button>
        </div>

        <div className="space-y-2">
          <Label>{t('tauri.demo.fileSelection')}</Label>
          <Button onClick={handleOpenDialog}>{t('tauri.demo.openFileDialog')}</Button>
          {selectedPath && (
            <p className="text-sm text-muted-foreground mt-2">
              {t('tauri.demo.selectedPath', { selectedPath })}
            </p>
          )}
        </div>

        <div className="text-sm text-muted-foreground pt-4">
          <h3 className="font-medium mb-2">{t('tauri.demo.featuresAvailable')}</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>{t('tauri.demo.features.nativeFileSystem')}</li>
            <li>{t('tauri.demo.features.systemDialog')}</li>
            <li>{t('tauri.demo.features.desktopNotifications')}</li>
            <li>{t('tauri.demo.features.menuBar')}</li>
            <li>{t('tauri.demo.features.systemTray')}</li>
            <li>{t('tauri.demo.features.autoUpdater')}</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

export default TauriDemo;