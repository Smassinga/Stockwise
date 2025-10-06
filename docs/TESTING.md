# Stockwise Testing Strategy

This document outlines the testing approach for Stockwise, including unit tests, integration tests, end-to-end tests, and quality assurance processes.

## Testing Philosophy

Stockwise follows a comprehensive testing approach that includes:

1. **Unit Testing**: Testing individual components and functions in isolation
2. **Integration Testing**: Testing interactions between components and services
3. **End-to-End Testing**: Testing complete user workflows
4. **Manual Testing**: Human verification of critical functionality
5. **Accessibility Testing**: Ensuring the application is accessible to all users

## Testing Tools and Frameworks

### Unit and Integration Testing

- **Jest**: JavaScript testing framework
- **React Testing Library**: For testing React components
- **Supertest**: For API testing (if backend APIs are developed)
- **Mock Service Worker (MSW)**: For mocking API requests

### End-to-End Testing

- **Cypress**: End-to-end testing framework
- **Cypress Testing Library**: For selecting elements in tests

### Static Analysis

- **ESLint**: JavaScript/TypeScript linting
- **Stylelint**: CSS linting
- **TypeScript Compiler**: Type checking

### Performance Testing

- **Lighthouse**: Web performance and accessibility auditing
- **WebPageTest**: Detailed performance analysis

## Unit Testing

### Component Testing

Components are tested using React Testing Library with a focus on user behavior rather than implementation details.

#### Example Component Test

```typescript
// src/components/ui/button.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('Button', () => {
  it('renders with correct text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    
    await user.click(screen.getByText('Click me'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('shows loading state when isLoading is true', () => {
    render(<Button isLoading>Click me</Button>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
```

### Hook Testing

Custom hooks are tested using React Hooks Testing Library.

#### Example Hook Test

```typescript
// src/hooks/useAuth.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useAuth } from './useAuth';

// Mock Supabase client
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } }
      })),
      getSession: jest.fn()
    }
  }
}));

describe('useAuth', () => {
  it('initializes with loading state', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.loading).toBe(true);
  });

  it('provides login function', () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.login).toBe('function');
  });
});
```

### Utility Function Testing

Utility functions are tested with various input scenarios.

#### Example Utility Test

```typescript
// src/lib/utils.test.ts
import { cn, formatCurrency } from './utils';

describe('utils', () => {
  describe('cn', () => {
    it('merges class names correctly', () => {
      const result = cn('class1', 'class2');
      expect(result).toBe('class1 class2');
    });
  });

  describe('formatCurrency', () => {
    it('formats currency correctly', () => {
      const result = formatCurrency(1234.56, 'USD');
      expect(result).toBe('$1,234.56');
    });

    it('handles negative values', () => {
      const result = formatCurrency(-1234.56, 'USD');
      expect(result).toBe('-$1,234.56');
    });
  });
});
```

## Integration Testing

### API Integration Testing

Testing the integration between frontend components and Supabase API.

#### Example API Integration Test

```typescript
// src/lib/supabase.test.ts
import { supabase } from './supabase';

describe('supabase client', () => {
  it('is configured with correct URL', () => {
    expect(supabase).toBeDefined();
  });

  it('has auth methods', () => {
    expect(supabase.auth).toBeDefined();
    expect(typeof supabase.auth.signInWithPassword).toBe('function');
  });
});
```

### Service Integration Testing

Testing integration between services and components.

#### Example Service Integration Test

```typescript
// src/lib/authFetch.test.ts
import { authFetch } from './authFetch';

// Mock global fetch
global.fetch = jest.fn();

describe('authFetch', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  it('makes authenticated requests', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: 'test' })
    });

    const result = await authFetch('/api/test');
    expect(result).toEqual({ data: 'test' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/test'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': expect.stringMatching(/Bearer .+/)
        })
      })
    );
  });
});
```

## End-to-End Testing

### Cypress Test Structure

End-to-end tests are organized by feature and user workflow.

#### Example E2E Test

```javascript
// cypress/e2e/auth.cy.js
describe('Authentication', () => {
  beforeEach(() => {
    cy.visit('/auth');
  });

  it('allows user to sign up', () => {
    cy.contains('Sign up').click();
    cy.get('[data-testid="name-input"]').type('Test User');
    cy.get('[data-testid="email-input"]').type('test@example.com');
    cy.get('[data-testid="password-input"]').type('password123');
    cy.get('[data-testid="submit-button"]').click();
    cy.contains('Verify your email').should('be.visible');
  });

  it('allows user to sign in', () => {
    cy.get('[data-testid="email-input"]').type('test@example.com');
    cy.get('[data-testid="password-input"]').type('password123');
    cy.get('[data-testid="submit-button"]').click();
    cy.url().should('include', '/dashboard');
  });
});
```

#### Dashboard E2E Test

```javascript
// cypress/e2e/dashboard.cy.js
describe('Dashboard', () => {
  beforeEach(() => {
    // Login before each test
    cy.login('test@example.com', 'password123');
    cy.visit('/dashboard');
  });

  it('displays key metrics', () => {
    cy.contains('Inventory Value').should('be.visible');
    cy.contains('Revenue').should('be.visible');
    cy.contains('COGS').should('be.visible');
    cy.contains('Gross Margin').should('be.visible');
  });

  it('allows navigation to other pages', () => {
    cy.contains('Items').click();
    cy.url().should('include', '/items');
  });
});
```

### Testing User Workflows

#### Item Creation Workflow

```javascript
// cypress/e2e/items.cy.js
describe('Item Management', () => {
  beforeEach(() => {
    cy.login('test@example.com', 'password123');
    cy.visit('/items');
  });

  it('allows creating a new item', () => {
    cy.contains('Create Item').click();
    cy.get('[data-testid="name-input"]').type('Test Product');
    cy.get('[data-testid="sku-input"]').type('TEST-001');
    cy.get('[data-testid="base-uom-select"]').select('EACH');
    cy.get('[data-testid="min-stock-input"]').type('10');
    cy.get('[data-testid="save-button"]').click();
    cy.contains('Item created successfully').should('be.visible');
    cy.contains('Test Product').should('be.visible');
  });
});
```

## Test Organization

### File Structure

```
src/
├── components/
│   └── ui/
│       ├── button.test.tsx
│       └── ...
├── hooks/
│   ├── useAuth.test.tsx
│   └── ...
├── lib/
│   ├── utils.test.ts
│   └── ...
├── pages/
│   ├── Dashboard.test.tsx
│   └── ...
└── __mocks__/
    └── supabase.ts
```

### Test Data Management

Use factories for consistent test data:

```typescript
// src/test-utils/factories.ts
export const createUser = (overrides = {}) => ({
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  ...overrides
});

export const createCompany = (overrides = {}) => ({
  id: 'company-1',
  trade_name: 'Test Company',
  legal_name: 'Test Company Ltd',
  base_currency: 'USD',
  ...overrides
});
```

## Test Execution

### Running Tests

1. **Unit Tests**: `npm test`
2. **Unit Tests (Watch Mode)**: `npm test -- --watch`
3. **Coverage Report**: `npm test -- --coverage`
4. **E2E Tests**: `npm run cypress:open`

### Continuous Integration

Tests are run automatically in CI pipeline:

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test
      - run: npm run cypress:run
```

## Code Coverage

### Coverage Goals

- **Components**: 80%+ coverage
- **Hooks**: 80%+ coverage
- **Utilities**: 90%+ coverage
- **Services**: 85%+ coverage

### Coverage Reports

Coverage reports are generated with each test run and can be viewed in:
- `coverage/` directory
- CI pipeline artifacts

## Accessibility Testing

### Automated Accessibility Testing

Using tools like:
- **eslint-plugin-jsx-a11y**: Static analysis for accessibility issues
- **axe-core**: Runtime accessibility testing

#### Example Accessibility Test

```typescript
// src/components/ui/button.test.tsx
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { Button } from './button';

describe('Button accessibility', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(<Button>Click me</Button>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

### Manual Accessibility Testing

1. **Keyboard Navigation**: Test all functionality with keyboard only
2. **Screen Readers**: Test with popular screen readers
3. **Color Contrast**: Verify sufficient color contrast
4. **Focus Management**: Ensure proper focus indicators

## Performance Testing

### Lighthouse Audits

Regular Lighthouse audits for:
- Performance
- Accessibility
- Best Practices
- SEO

### WebPageTest

Detailed performance analysis including:
- Load times
- Render blocking resources
- Optimization opportunities

## Quality Assurance Process

### Pre-Commit Checks

Using husky and lint-staged:
1. **ESLint**: Code style and potential errors
2. **Stylelint**: CSS style checking
3. **TypeScript**: Type checking
4. **Unit Tests**: Quick test validation

### Pre-Push Checks

1. **Full Test Suite**: All unit and integration tests
2. **E2E Tests**: Critical user workflows
3. **Build Process**: Verify production build

### Release Process

1. **Regression Testing**: Full test suite execution
2. **Accessibility Audit**: Manual and automated checks
3. **Performance Audit**: Lighthouse and WebPageTest
4. **Security Scan**: Dependency vulnerability check

## Test Maintenance

### Keeping Tests Up-to-Date

1. **Refactor Tests**: When refactoring components
2. **Update Snapshots**: When UI changes intentionally
3. **Add New Tests**: For new features
4. **Remove Obsolete Tests**: When removing functionality

### Dealing with Flaky Tests

1. **Identify Flaky Tests**: Monitor test runs for inconsistencies
2. **Fix Root Causes**: Address timing issues, race conditions
3. **Retry Mechanisms**: Implement retry logic where appropriate
4. **Isolate Tests**: Ensure tests don't depend on each other

This testing strategy ensures Stockwise maintains high quality and reliability while enabling rapid development and confident deployments.