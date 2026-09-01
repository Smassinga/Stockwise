import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const serviceJobsSource = fs.readFileSync(
  new URL('../../src/pages/ServiceJobs.tsx', import.meta.url),
  'utf8',
)

test('Service Jobs uses the mounted react-hot-toast renderer', () => {
  assert.match(serviceJobsSource, /from ['"]react-hot-toast['"]/)
  assert.doesNotMatch(serviceJobsSource, /from ['"]sonner['"]/)
})
