# Stockwise Troubleshooting Guide

This document provides solutions to common issues you may encounter when using or developing Stockwise.

## Development Issues

### Environment Setup Problems

#### npm install fails

**Problem**: Dependency installation fails with errors.

**Solutions**:
1. Clear npm cache: `npm cache clean --force`
2. Delete node_modules and package-lock.json:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```
3. Check Node.js version compatibility
4. Ensure you have sufficient disk space

#### Environment Variables Not Loading

**Problem**: Environment variables are undefined in the application.

**Solutions**:
1. Verify `.env` file exists and is properly formatted
2. Ensure variables are prefixed with `VITE_` for Vite to process them
3. Restart the development server after changing environment variables
4. Check for typos in variable names

### Development Server Issues

#### Development Server Won't Start

**Problem**: `npm run dev` fails to start the development server.

**Solutions**:
1. Check for port conflicts (default is 5173)
2. Verify all dependencies are installed
3. Check for syntax errors in configuration files
4. Review terminal output for specific error messages

#### Hot Module Replacement Not Working

**Problem**: Changes to code don't reflect in the browser automatically.

**Solutions**:
1. Restart the development server
2. Check browser console for HMR errors
3. Verify file paths are correct
4. Disable browser extensions that might interfere

### Build Issues

#### Production Build Fails

**Problem**: `npm run build` fails with errors.

**Solutions**:
1. Check for TypeScript errors: `npm run type-check`
2. Verify all imports are correct
3. Check for circular dependencies
4. Review build logs for specific error messages

#### Build Succeeds But Application Doesn't Work

**Problem**: Application builds successfully but has runtime errors.

**Solutions**:
1. Check browser console for errors
2. Verify environment variables are set for production
3. Ensure all API endpoints are correctly configured
4. Test build locally with `npm run preview`

## Authentication Issues

### Sign Up Problems

#### Email Verification Not Received

**Problem**: User doesn't receive verification email after sign up.

**Solutions**:
1. Check spam/junk folders
2. Verify email address was entered correctly
3. Check Supabase authentication settings
4. Ensure SMTP settings are configured correctly in Supabase

#### Account Creation Fails

**Problem**: Error message when trying to create an account.

**Solutions**:
1. Check password requirements (minimum 6 characters)
2. Verify email format is correct
3. Ensure email is not already registered
4. Check network connectivity to Supabase

### Sign In Problems

#### Invalid Credentials

**Problem**: "Invalid login credentials" error when signing in.

**Solutions**:
1. Verify email and password are correct
2. Check if account has been verified
3. Reset password if needed
4. Ensure no extra spaces in email/password fields

#### Session Issues

**Problem**: User gets logged out unexpectedly or session doesn't persist.

**Solutions**:
1. Check browser storage settings (localStorage must be enabled)
2. Verify Supabase session settings
3. Check for browser extensions that clear storage
4. Test in incognito/private browsing mode

## Database Issues

### Connection Problems

#### Database Connection Failed

**Problem**: Application cannot connect to Supabase database.

**Solutions**:
1. Verify `VITE_SUPABASE_URL` environment variable
2. Check Supabase project status
3. Ensure network connectivity to Supabase
4. Verify Supabase credentials are correct

#### RLS (Row Level Security) Errors

**Problem**: Permission denied errors when accessing data.

**Solutions**:
1. Verify user is authenticated
2. Check company membership status
3. Review RLS policies in Supabase
4. Ensure user has appropriate role for requested operation

### Data Issues

#### Missing Data

**Problem**: Expected data doesn't appear in the application.

**Solutions**:
1. Check database directly using Supabase dashboard
2. Verify company_id filtering is correct
3. Check date ranges and filters
4. Ensure user has permission to view the data

#### Data Not Saving

**Problem**: Changes to data don't persist in the database.

**Solutions**:
1. Check browser console for errors
2. Verify user has write permissions
3. Check for validation errors in forms
4. Review Supabase logs for failed operations

## UI/UX Issues

### Rendering Problems

#### Components Not Displaying

**Problem**: UI components are missing or not rendering correctly.

**Solutions**:
1. Check browser console for JavaScript errors
2. Verify all required props are passed to components
3. Check for CSS conflicts
4. Ensure Tailwind CSS is properly configured

#### Layout Issues

**Problem**: Page layout appears broken or misaligned.

**Solutions**:
1. Check for missing CSS classes
2. Verify responsive design breakpoints
3. Check for conflicting styles
4. Test on different screen sizes

### Performance Issues

#### Slow Page Loading

**Problem**: Pages take too long to load.

**Solutions**:
1. Check network tab for slow API requests
2. Implement pagination for large datasets
3. Optimize database queries
4. Use React.memo for expensive components

#### Application Freezes

**Problem**: UI becomes unresponsive during certain operations.

**Solutions**:
1. Check for infinite loops in code
2. Optimize expensive computations
3. Use Web Workers for heavy processing
4. Implement loading states for long operations

## API Issues

### Supabase API Errors

#### Rate Limiting

**Problem**: Too many requests error from Supabase.

**Solutions**:
1. Implement request throttling in the application
2. Cache frequently accessed data
3. Optimize queries to reduce number of requests
4. Review Supabase pricing tier limits

#### Invalid Queries

**Problem**: Database queries return unexpected results or errors.

**Solutions**:
1. Verify query syntax
2. Check field names and data types
3. Review Supabase documentation for correct usage
4. Test queries directly in Supabase SQL editor

### Real-time Issues

#### Subscriptions Not Working

**Problem**: Real-time updates are not received.

**Solutions**:
1. Verify Supabase real-time is enabled
2. Check subscription setup in code
3. Ensure user has permissions to the data
4. Review Supabase logs for connection issues

## Deployment Issues

### Vercel Deployment Failures

#### Build Failures

**Problem**: Deployment fails during build process.

**Solutions**:
1. Check Vercel build logs for specific errors
2. Verify environment variables are set in Vercel
3. Ensure all dependencies are in package.json
4. Check for syntax errors in code

#### Runtime Errors After Deployment

**Problem**: Application works locally but fails after deployment.

**Solutions**:
1. Check browser console for errors
2. Verify environment variables in Vercel
3. Ensure Supabase credentials are correct for production
4. Test API endpoints are accessible from deployed application

### Custom Domain Issues

#### Domain Not Resolving

**Problem**: Custom domain shows Vercel error page.

**Solutions**:
1. Verify DNS records are correctly configured
2. Check domain configuration in Vercel dashboard
3. Wait for DNS propagation (can take up to 48 hours)
4. Verify domain is not blocked by firewall

#### HTTPS Certificate Issues

**Problem**: Browser shows security warnings for custom domain.

**Solutions**:
1. Check Vercel SSL certificate status
2. Verify DNS configuration is complete
3. Contact Vercel support if issues persist
4. Check for mixed content warnings (HTTP resources on HTTPS page)

## Browser Compatibility

### Cross-Browser Issues

#### Feature Not Working in Specific Browser

**Problem**: Functionality works in one browser but not another.

**Solutions**:
1. Check browser console for compatibility errors
2. Verify JavaScript features are supported in target browsers
3. Use polyfills for unsupported features
4. Test in multiple browsers during development

### Mobile Issues

#### Mobile Layout Problems

**Problem**: Application doesn't display correctly on mobile devices.

**Solutions**:
1. Test responsive design on various screen sizes
2. Check touch event handling
3. Verify mobile-friendly navigation
4. Test on actual mobile devices, not just browser dev tools

## Internationalization Issues

### Translation Problems

#### Text Not Translating

**Problem**: UI text appears in English despite language selection.

**Solutions**:
1. Verify translation keys exist in locale files
2. Check language switcher implementation
3. Ensure i18n context is properly provided
4. Verify browser language settings

#### Missing Translations

**Problem**: Some text appears as translation keys instead of translated text.

**Solutions**:
1. Add missing keys to locale files
2. Check for typos in translation keys
3. Verify locale files are properly loaded
4. Test all languages thoroughly

## Testing Issues

### Test Failures

#### Unit Tests Failing

**Problem**: Tests that previously passed are now failing.

**Solutions**:
1. Check for recent code changes that might affect tests
2. Verify test data and mocks are up to date
3. Check for environmental differences between test and dev
4. Review test output for specific failure reasons

#### End-to-End Tests Flaky

**Problem**: E2E tests sometimes pass and sometimes fail.

**Solutions**:
1. Add waits for asynchronous operations
2. Check for timing issues in tests
3. Verify test data is consistent
4. Review test isolation between runs

## Security Issues

### Authentication Bypass

**Problem**: Unauthorized access to protected resources.

**Solutions**:
1. Review route protection implementation
2. Verify authentication checks in components
3. Check Supabase RLS policies
4. Test all protected routes manually

### Data Exposure

**Problem**: Sensitive data visible to unauthorized users.

**Solutions**:
1. Review database RLS policies
2. Check API query filtering
3. Verify frontend data display logic
4. Audit user role permissions

## Performance Optimization

### Memory Leaks

**Problem**: Application performance degrades over time.

**Solutions**:
1. Use browser memory profiling tools
2. Check for unsubscribed event listeners
3. Verify component cleanup in useEffect hooks
4. Review real-time subscription management

### Large Bundle Size

**Problem**: Application takes too long to load.

**Solutions**:
1. Analyze bundle size with tools like webpack-bundle-analyzer
2. Implement code splitting for routes
3. Remove unused dependencies
4. Optimize images and assets

This troubleshooting guide covers the most common issues encountered with Stockwise. If you experience a problem not covered here, please check the browser console for error messages and consult the relevant documentation or seek help from the community.