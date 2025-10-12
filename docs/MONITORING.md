# Stockwise Monitoring Guide

This document provides guidance on monitoring the Stockwise application in production environments.

## Overview

Stockwise uses a combination of built-in monitoring capabilities from hosting platforms (Vercel and Supabase) along with optional third-party monitoring solutions.

## Vercel Monitoring

### Performance Monitoring

Vercel provides built-in performance monitoring:
- Page load times
- Time to first byte (TTFB)
- First contentful paint (FCP)
- Largest contentful paint (LCP)
- Cumulative layout shift (CLS)

### Analytics

Vercel Analytics provides:
- Visitor statistics
- Geographical distribution
- Device and browser information
- Page view tracking
- Custom event tracking

### Error Tracking

Vercel automatically captures:
- Build errors
- Runtime errors
- 404 errors
- Serverless function errors

## Supabase Monitoring

### Database Performance

Supabase provides database monitoring:
- Query performance metrics
- Database load
- Connection statistics
- Storage usage

### API Monitoring

Supabase tracks:
- API request rates
- Response times
- Error rates
- Authentication metrics

### Logs

Supabase provides detailed logs for:
- Database queries
- Authentication events
- Function executions
- Storage operations

### Edge Function Monitoring

Monitor the due reminder worker and other Edge Functions:
- Execution success rates
- Error rates
- Execution times
- Resource usage

## Third-Party Monitoring Solutions

### Sentry Integration

For enhanced error tracking, integrate Sentry:

1. Create a Sentry account at [sentry.io](https://sentry.io)
2. Create a new project for Stockwise
3. Install the Sentry SDK:
   ```bash
   npm install @sentry/react @sentry/browser
   ```
4. Initialize Sentry in your application:
   ```typescript
   import * as Sentry from "@sentry/react";
   
   Sentry.init({
     dsn: "YOUR_SENTRY_DSN",
     integrations: [
       new Sentry.BrowserTracing(),
       new Sentry.Replay(),
     ],
     tracesSampleRate: 1.0,
     replaysSessionSampleRate: 0.1,
     replaysOnErrorSampleRate: 1.0,
   });
   ```

### LogRocket Integration

For session replay and user behavior tracking:

1. Create a LogRocket account at [logrocket.com](https://logrocket.com)
2. Install the LogRocket SDK:
   ```bash
   npm install logrocket
   ```
3. Initialize LogRocket:
   ```typescript
   import LogRocket from 'logrocket';
   
   LogRocket.init('your-app-id');
   ```

## Custom Monitoring

### Application Health Checks

Implement health check endpoints:
```typescript
// Example health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

### Business Metrics Tracking

Track key business metrics:
- User signups
- Item creation
- Order processing
- Inventory movements

### Performance Metrics

Monitor key performance indicators:
- API response times
- Database query performance
- Authentication success rates
- Page load times

## Alerting

### Vercel Alerts

Configure alerts in Vercel:
- Deployment failures
- Performance degradation
- Error rate spikes
- Usage limits

### Supabase Alerts

Set up alerts in Supabase:
- Database performance issues
- Unusual API usage patterns
- Authentication failures
- Storage limits

### Due Reminder Worker Alerts

Set up alerts for the due reminder system:
- Job processing failures
- Empty reminder batches (indicating no qualifying orders)
- SendGrid API errors
- Queue backlog buildup

### Custom Alerting

Implement custom alerting for business-critical metrics:
- Low stock alerts
- Order processing delays
- Authentication anomalies
- Data consistency issues

## Monitoring Dashboard

### Creating a Monitoring Dashboard

Use tools like:
- Grafana for custom dashboards
- Datadog for comprehensive monitoring
- New Relic for full-stack observability

### Key Metrics to Display

1. **Application Health**
   - Uptime percentage
   - Response time trends
   - Error rates

2. **Business Metrics**
   - Daily active users
   - New signups
   - Order volume
   - Revenue metrics

3. **System Performance**
   - Database query performance
   - API response times
   - CDN performance
   - Third-party service status

4. **Due Reminder Worker Metrics**
   - Jobs processed per hour
   - Success vs failure rates
   - Average processing time
   - Queue depth

## Best Practices

### Proactive Monitoring

- Set up alerts for critical metrics
- Monitor trends, not just current values
- Implement synthetic monitoring for key user flows
- Regularly review and update monitoring configurations

### Incident Response

- Document incident response procedures
- Set up escalation paths
- Create runbooks for common issues
- Conduct post-mortem analysis for major incidents

### Performance Optimization

- Monitor performance trends over time
- Identify and address performance bottlenecks
- Optimize database queries based on slow query logs
- Implement caching strategies where appropriate

## Troubleshooting

### Common Monitoring Issues

1. **Missing Metrics**
   - Verify monitoring integrations are properly configured
   - Check for network connectivity issues
   - Ensure proper permissions for monitoring services

2. **False Alerts**
   - Adjust alert thresholds based on historical data
   - Implement alert deduplication
   - Add context to alerts to reduce noise

3. **Performance Impact**
   - Minimize monitoring overhead
   - Use sampling for high-volume metrics
   - Optimize monitoring queries

### Due Reminder Worker Troubleshooting

If the due reminder worker returns "no reminders for window":

1. **Check the Queue**
   - Verify jobs exist in `due_reminder_queue`
   - Check job status and payload

2. **Verify Sales Orders**
   - Ensure sales orders exist for the company
   - Check due dates match lead days
   - Confirm orders have positive amounts
   - Verify order status is not cancelled/void/draft

3. **Validate Email Addresses**
   - Ensure customers have email addresses
   - Check for override recipients in job payload

4. **Test the Batch Function**
   - Run `build_due_reminder_batch` manually
   - Verify it returns expected results

## Conclusion

Effective monitoring is crucial for maintaining a reliable and performant Stockwise application. By leveraging the built-in monitoring capabilities of Vercel and Supabase, along with optional third-party solutions, you can ensure your application remains healthy and provides a great user experience.

Regularly review your monitoring setup and adjust as your application grows and evolves.