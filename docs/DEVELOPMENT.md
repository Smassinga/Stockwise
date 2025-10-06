# Stockwise Development Guide

This document provides guidelines and best practices for developing Stockwise, including setup, coding standards, testing, and deployment procedures.

## Development Environment Setup

### Prerequisites

1. **Node.js**: Version specified in package.json (check engines field)
2. **npm**: Version 6.0 or higher
3. **Git**: For version control
4. **Code Editor**: VS Code recommended with suggested extensions
5. **Supabase Account**: For backend services

### Initial Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd stockwise
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

### Supabase Setup

1. Create a Supabase project at https://app.supabase.com
2. Get your project URL and anon key from Settings > API
3. Update your `.env` file with these values:
   ```
   VITE_SUPABASE_URL=your_project_url
   VITE_SUPABASE_ANON_KEY=your_anon_key
   ```

4. Set up the database schema using the provided SQL scripts or Supabase migrations

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── layout/          # Layout components
│   ├── ui/              # shadcn/ui components
│   └── ...              # Feature-specific components
├── hooks/               # Custom React hooks
├── lib/                 # Utility functions and services
├── locales/             # Internationalization files
├── pages/               # Page components
├── types/               # TypeScript type definitions
├── App.tsx              # Main application component
└── main.tsx             # Application entry point
```

## Coding Standards

### TypeScript

1. **Strict Typing**: Use strict TypeScript with no implicit any
2. **Interfaces**: Define interfaces for complex objects
3. **Enums**: Use enums for constants and status values
4. **Type Safety**: Leverage TypeScript's type system for better code reliability

### React

1. **Functional Components**: Use functional components with hooks
2. **Custom Hooks**: Extract reusable logic into custom hooks
3. **Component Composition**: Favor composition over inheritance
4. **Props Validation**: Use TypeScript interfaces for props validation

### Styling

1. **Tailwind CSS**: Use Tailwind CSS for styling
2. **shadcn/ui**: Use shadcn/ui components for consistent UI
3. **CSS Modules**: For component-specific styles when needed
4. **Responsive Design**: Ensure all components are mobile-responsive

### Code Organization

1. **Single Responsibility**: Each component/file should have a single responsibility
2. **Logical Grouping**: Group related functionality together
3. **Clear Naming**: Use descriptive names for variables, functions, and components
4. **Consistent Structure**: Follow established patterns in the codebase

## Component Development

### Creating New Components

1. Create the component file in the appropriate directory under `src/components/`
2. Use TypeScript interfaces for props
3. Implement proper error handling
4. Add accessibility attributes where needed
5. Ensure responsive design
6. Write unit tests (if applicable)

### Component Structure

```typescript
// Example component structure
import React from 'react';
import { useI18n } from '../lib/i18n';

interface Props {
  title: string;
  onAction: () => void;
}

export const MyComponent: React.FC<Props> = ({ title, onAction }) => {
  const { t } = useI18n();
  
  return (
    <div className="my-component">
      <h2>{title}</h2>
      <button onClick={onAction}>{t('actions.save')}</button>
    </div>
  );
};
```

## State Management

### Context API

Stockwise uses React Context API for state management:

1. **Auth Context**: User authentication state
2. **Org Context**: Organization/company state
3. **I18n Context**: Internationalization state
4. **Feature Contexts**: Specific feature contexts (e.g., Reports)

### Best Practices

1. **Keep Context Light**: Only store essential state in context
2. **Use Reducers**: For complex state logic, use useReducer
3. **Memoization**: Use useMemo and useCallback appropriately
4. **Performance**: Avoid unnecessary re-renders

## Internationalization

### Adding New Translations

1. Add new keys to `src/locales/en.json`
2. Add corresponding translations to other language files
3. Use the `t` function from `useI18n` hook in components

### Translation Keys

Follow this naming convention:
```
feature.section.element
```

Example:
```json
{
  "dashboard.title": "Dashboard",
  "items.create.title": "Create Item",
  "orders.poDetails": "PO Details"
}
```

## Testing

### Unit Testing

1. **Test Framework**: Use Jest with React Testing Library
2. **Test Coverage**: Aim for 80%+ test coverage for critical components
3. **Mocking**: Mock external dependencies and API calls
4. **Test Organization**: Co-locate tests with the components they test

### Testing Components

```typescript
// Example component test
import { render, screen } from '@testing-library/react';
import { MyComponent } from './MyComponent';

describe('MyComponent', () => {
  it('renders title correctly', () => {
    render(<MyComponent title="Test Title" onAction={jest.fn()} />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });
});
```

### End-to-End Testing

1. **Test Framework**: Use Cypress for E2E tests
2. **Test Scenarios**: Cover critical user flows
3. **Data Setup**: Use test data that doesn't interfere with production

## API Integration

### Supabase Client

All API interactions use the Supabase client:

```typescript
import { supabase } from '../lib/supabase';

// Example query
const { data, error } = await supabase
  .from('items')
  .select('*')
  .eq('company_id', companyId);
```

### Error Handling

Always handle API errors gracefully:

```typescript
try {
  const { data, error } = await supabase
    .from('items')
    .insert([newItem]);
    
  if (error) throw error;
  
  // Handle success
} catch (error) {
  // Handle error
  console.error('Failed to create item:', error);
}
```

## Performance Optimization

### Code Splitting

Use React.lazy for route-based code splitting:

```typescript
const Dashboard = lazy(() => import('./pages/Dashboard'));
```

### Memoization

Use useMemo and useCallback for expensive computations:

```typescript
const expensiveValue = useMemo(() => {
  // Expensive computation
  return computeExpensiveValue(a, b);
}, [a, b]);
```

### Virtualization

For large lists, use virtualization libraries like react-window.

## Security

### Authentication

1. **Protect Routes**: Use route guards for authenticated areas
2. **Validate Permissions**: Check user roles for sensitive operations
3. **Secure Storage**: Store tokens securely

### Data Validation

1. **Client-side**: Validate user input
2. **Server-side**: Validate all data before database operations
3. **Sanitization**: Sanitize user input to prevent XSS

## Git Workflow

### Branching Strategy

1. **main**: Production-ready code
2. **develop**: Development branch
3. **feature/branch-name**: Feature branches
4. **bugfix/branch-name**: Bug fix branches
5. **release/version**: Release preparation branches

### Commit Messages

Follow conventional commit format:
```
type(scope): description

body (optional)

footer (optional)
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `chore`: Maintenance tasks
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test-related changes
- `perf`: Performance improvements

### Pull Requests

1. **Descriptive Titles**: Clear, concise PR titles
2. **Detailed Descriptions**: Explain what changed and why
3. **Screenshots**: Include screenshots for UI changes
4. **Reviewers**: Assign appropriate reviewers
5. **Tests**: Ensure all tests pass

## Deployment

### Environment Variables

Ensure all required environment variables are set:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SITE_URL`

### Build Process

1. **Production Build**: `npm run build`
2. **Preview**: `npm run preview`
3. **Testing**: Test build locally before deployment

### Continuous Deployment

Stockwise is configured for deployment on Vercel:
1. Connect GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Configure build settings (Vercel detects automatically)
4. Enable automatic deployments for main branch

## Debugging

### Browser Developer Tools

1. **React DevTools**: Inspect component hierarchy and state
2. **Network Tab**: Monitor API requests
3. **Console**: Check for errors and logs
4. **Performance Tab**: Analyze performance bottlenecks

### Supabase Debugging

1. **SQL Logs**: Check Supabase SQL logs for query performance
2. **Authentication Logs**: Monitor auth events
3. **Real-time Logs**: Debug real-time subscriptions

### Error Tracking

1. **Console Errors**: Check browser console for runtime errors
2. **Network Errors**: Monitor failed API requests
3. **User Reports**: Implement error reporting for production

## Troubleshooting

### Common Issues

1. **Authentication Failures**: Check Supabase credentials and URL
2. **Missing Environment Variables**: Verify all required env vars are set
3. **Database Connection**: Ensure Supabase database is accessible
4. **Build Errors**: Check for TypeScript errors and missing dependencies

### Development Server Issues

1. **Port Conflicts**: Change port in vite.config.ts
2. **HMR Issues**: Restart development server
3. **Cache Problems**: Clear node_modules and reinstall

This development guide provides a comprehensive overview of the development workflow for Stockwise. Following these guidelines will help maintain code quality and consistency across the project.