# Stockwise Deployment Guide

This document provides instructions for deploying Stockwise to production environments.

## Deployment Architecture

Stockwise follows a modern web application deployment architecture:

```
Users ─── CDN ─── Vercel (Frontend) ─── Supabase (Backend)
                    │
                    └── Custom Domain
```

## Prerequisites

Before deploying, ensure you have:

1. **Supabase Account**: A Supabase project with configured database
2. **Vercel Account**: For frontend deployment
3. **Domain Name**: (Optional) Custom domain for your application
4. **Environment Variables**: All required environment variables ready

## Supabase Setup

### 1. Create Supabase Project

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click "New Project"
3. Enter project details:
   - Name: Your project name
   - Database Password: Secure password
   - Region: Closest to your users
4. Click "Create Project"

### 2. Configure Database

1. In the Supabase dashboard, go to SQL Editor
2. Run the database schema setup scripts
3. Set up Row Level Security (RLS) policies
4. Configure authentication settings

### 3. Configure Authentication

1. Go to Authentication > Settings
2. Configure site URL: `https://your-domain.com`
3. Add additional redirect URLs as needed
4. Configure email templates (optional)

### 4. Set Up Storage

1. Go to Storage > Buckets
2. Create a bucket for company logos (e.g., `brand-logos`)
3. Configure bucket permissions

## Environment Variables

### Required Variables

Set these environment variables in your Vercel project:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_SITE_URL=https://your-domain.com
```

### How to Get These Values

1. In Supabase dashboard, go to Settings > API
2. Copy "Project URL" to `VITE_SUPABASE_URL`
3. Copy "anon public" key to `VITE_SUPABASE_ANON_KEY`

## Vercel Deployment

### 1. Connect Repository

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import your Git repository
4. Configure project settings:
   - Framework Preset: Vite
   - Root Directory: `/`
   - Build Command: `npm run build`
   - Output Directory: `dist`

### 2. Configure Environment Variables

1. In Vercel project settings, go to "Environment Variables"
2. Add all required environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_SITE_URL`

### 3. Configure Build Settings

1. In Vercel project settings, go to "General"
2. Set build command: `npm run build`
3. Set output directory: `dist`
4. Set install command: `npm install`

### 4. Deploy

1. Click "Deploy"
2. Vercel will automatically build and deploy your application
3. Monitor the build process in the Vercel dashboard

## Custom Domain Setup

### 1. Add Domain to Vercel

1. In Vercel dashboard, go to your project
2. Go to Settings > Domains
3. Add your custom domain

### 2. Configure DNS

1. Follow Vercel's DNS configuration instructions
2. Add the provided DNS records to your DNS provider
3. Wait for DNS propagation (usually 5-30 minutes)

### 3. Configure Supabase

1. In Supabase dashboard, go to Settings > API
2. Add your custom domain to "Additional Redirect URLs"
3. Update site URL if needed

## Database Migration

### Initial Migration

For new deployments:

1. Run the database setup scripts in Supabase SQL Editor
2. Configure RLS policies
3. Set up authentication settings

### Updating Existing Database

For existing deployments with schema changes:

1. Create a backup of your database
2. Review migration scripts
3. Apply migrations in a staging environment first
4. Apply migrations to production during maintenance window

## Monitoring and Analytics

### Vercel Analytics

Vercel provides built-in analytics:
1. Performance metrics
2. Visitor analytics
3. Geographical distribution

### Supabase Monitoring

Supabase provides:
1. Database performance metrics
2. API usage statistics
3. Authentication logs

### Error Tracking

Consider integrating error tracking:
1. Sentry for frontend error tracking
2. Supabase logs for backend issues

## Security Considerations

### Environment Variables

1. Never commit sensitive environment variables to version control
2. Use Vercel's environment variable management
3. Rotate credentials periodically

### HTTPS

1. Vercel automatically provides HTTPS for all deployments
2. Custom domains get free SSL certificates from Let's Encrypt

### Authentication

1. Use strong passwords for Supabase database
2. Regularly review authentication settings
3. Monitor authentication logs for suspicious activity

## Backup and Recovery

### Supabase Backups

1. Supabase automatically creates daily backups
2. Point-in-time recovery is available
3. Manual backups can be created through the dashboard

### Recovery Process

In case of data loss:

1. Identify the point of data loss
2. Use Supabase dashboard to restore from backup
3. Verify data integrity after restoration

## Scaling Considerations

### Supabase Scaling

1. Monitor database performance metrics
2. Upgrade to higher tiers as needed
3. Consider read replicas for high-traffic applications

### Vercel Scaling

1. Vercel automatically scales frontend resources
2. Monitor bandwidth and build minutes usage
3. Upgrade plan if needed

## Maintenance

### Regular Tasks

1. Monitor application performance
2. Review logs for errors
3. Update dependencies regularly
4. Rotate credentials periodically

### Updates

When updating the application:

1. Test changes in a staging environment
2. Create database backups before major updates
3. Deploy during low-traffic periods
4. Monitor application after deployment

## Troubleshooting

### Common Issues

1. **Environment Variables Not Set**: Check Vercel environment variables
2. **Database Connection Failed**: Verify Supabase credentials
3. **Authentication Issues**: Check Supabase auth settings
4. **Build Failures**: Check build logs in Vercel dashboard

### Getting Help

1. Check Vercel and Supabase documentation
2. Review application logs
3. Contact support if needed

This deployment guide provides a comprehensive overview of deploying Stockwise to production. Following these steps will help ensure a successful deployment with proper security and monitoring in place.