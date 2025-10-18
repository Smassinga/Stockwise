# Stockwise Deployment Guide

## Overview

This guide provides instructions for deploying Stockwise in various environments, from local development to production deployment. Stockwise is built as a modern web application that can be deployed to any static hosting service, with Supabase providing the backend services.

## Prerequisites

### Development Environment
- **Node.js**: Version 16 or higher
- **npm**: Version 6.0 or higher
- **Git**: For version control
- **Code Editor**: VS Code recommended
- **Supabase Account**: For backend services

### Production Environment
- **Static Hosting**: Vercel, Netlify, or similar
- **Supabase Project**: Backend services
- **Domain Name**: For custom domain setup (optional)

## Local Development Setup

### 1. Clone the Repository
```bash
git clone <repository-url>
cd stockwise
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables
```bash
cp .env.example .env
```

Edit the `.env` file with your Supabase credentials:
```
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_SITE_URL=http://localhost:3000
```

### 4. Start the Development Server
```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

## Supabase Setup

### 1. Create a Supabase Project
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click "New Project"
3. Enter project details
4. Wait for the project to be created

### 2. Configure Authentication
1. Navigate to "Authentication" → "Settings"
2. Configure email templates as needed
3. Set up email providers for production use

### 3. Set Up the Database
1. Navigate to "SQL Editor"
2. Run the database schema scripts
3. Set up Row Level Security (RLS) policies

### 4. Configure Real-time
1. Navigate to "Database" → "Replication"
2. Enable real-time for required tables

### 5. Set Up Storage (Optional)
1. Navigate to "Storage"
2. Create buckets for file uploads
3. Configure access policies

## Production Deployment

### Option 1: Vercel Deployment (Recommended)

#### 1. Connect to Vercel
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import your Git repository

#### 2. Configure Environment Variables
In the Vercel project settings, add the following environment variables:
- `VITE_SUPABASE_URL`: Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Your Supabase anonymous key
- `VITE_SITE_URL`: Your production domain (e.g., https://yourdomain.com)

#### 3. Configure Build Settings
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`

#### 4. Deploy
Click "Deploy" and wait for the build to complete.

### Option 2: Manual Deployment

#### 1. Build the Application
```bash
npm run build
```

This creates a `dist` folder with the production build.

#### 2. Deploy the Build
Upload the contents of the `dist` folder to your static hosting provider.

## Environment Configuration

### Environment Variables
Stockwise requires the following environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL | `https://your-project.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `VITE_SITE_URL` | Site URL for redirects | `https://yourdomain.com` |

### Supabase Configuration

#### Authentication Settings
1. **Email Templates**: Customize email templates in Supabase Auth settings
2. **Site URL**: Set the site URL for redirect URIs
3. **Email Providers**: Configure SMTP settings for production email delivery

#### Database Settings
1. **Connection Pooling**: Configure connection pool settings for high-traffic applications
2. **Replication**: Enable replication for real-time features
3. **Backups**: Set up automated backups

## Domain Configuration

### Custom Domain Setup (Vercel)
1. Navigate to your Vercel project
2. Go to "Settings" → "Domains"
3. Add your custom domain
4. Follow the DNS configuration instructions

### SSL Certificate
Vercel automatically provisions SSL certificates for custom domains.

## Monitoring and Analytics

### Performance Monitoring
1. **Vercel Analytics**: Built-in performance monitoring
2. **Supabase Logs**: Database query performance
3. **Browser DevTools**: Client-side performance profiling

### Error Tracking
1. **Browser Console**: Client-side error monitoring
2. **Supabase Logs**: Server-side error tracking
3. **Third-party Services**: Integrate with services like Sentry for comprehensive error tracking

## Security Considerations

### Authentication Security
1. **Secure Keys**: Keep Supabase keys secure
2. **JWT Tokens**: Use secure JWT token handling
3. **Session Management**: Implement proper session timeout

### Data Security
1. **Encryption**: Ensure data is encrypted in transit
2. **RLS Policies**: Implement proper Row Level Security
3. **Input Validation**: Validate all user inputs

### Network Security
1. **CORS**: Configure CORS settings appropriately
2. **Rate Limiting**: Implement rate limiting
3. **Firewall**: Use firewall rules where applicable

## Backup and Recovery

### Database Backups
1. **Supabase Backups**: Enable automated backups in Supabase
2. **Manual Backups**: Create manual backups before major changes
3. **Point-in-time Recovery**: Use Supabase point-in-time recovery when needed

### Code Backups
1. **Git Repository**: Maintain a Git repository with all code
2. **Version Tags**: Tag releases for easy rollback
3. **Branch Strategy**: Use proper Git branching strategy

## Scaling Considerations

### Horizontal Scaling
1. **Static Assets**: Serve static assets through CDN
2. **Database Connections**: Use connection pooling
3. **Caching**: Implement client-side and server-side caching

### Performance Optimization
1. **Code Splitting**: Use React lazy loading for routes
2. **Image Optimization**: Optimize images for web delivery
3. **Bundle Optimization**: Minimize bundle size

## Maintenance

### Regular Updates
1. **Dependency Updates**: Regularly update npm dependencies
2. **Security Patches**: Apply security patches promptly
3. **Supabase Updates**: Keep up with Supabase platform updates

### Monitoring
1. **Uptime Monitoring**: Set up uptime monitoring
2. **Performance Monitoring**: Monitor application performance
3. **Error Rate Monitoring**: Track error rates and resolve issues

## Troubleshooting

### Common Issues

#### Build Failures
1. Check for TypeScript errors
2. Verify all dependencies are installed
3. Check environment variable configuration

#### Runtime Errors
1. Check browser console for errors
2. Verify Supabase connection
3. Check network connectivity

#### Authentication Issues
1. Verify Supabase Auth configuration
2. Check redirect URIs
3. Verify environment variables

### Support
For issues not covered in this guide:
1. Check the browser console for error messages
2. Review Supabase logs
3. Consult the Stockwise documentation
4. Contact support if you have a support agreement

## Updating the Application

### Minor Updates
1. Pull the latest changes from the repository
2. Run `npm install` to update dependencies
3. Test the application locally
4. Deploy to production

### Major Updates
1. Review release notes for breaking changes
2. Update dependencies as required
3. Run database migrations if needed
4. Test thoroughly before deploying

This deployment guide provides comprehensive instructions for deploying Stockwise in various environments. Follow these steps to successfully deploy and maintain your Stockwise installation.