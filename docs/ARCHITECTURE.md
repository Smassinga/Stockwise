# Stockwise Architecture

This document provides a detailed overview of the Stockwise system architecture, including frontend components, data flow, and backend integration.

## System Overview

Stockwise is a modern inventory management system designed for businesses of all sizes. The architecture is built around a client-server model with a React frontend and Supabase backend.

### High-Level Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Browser   │◄──►│  React Frontend  │◄──►│  Supabase API   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │                        │
                              ▼                        ▼
                    ┌──────────────────┐    ┌─────────────────┐
                    │  UI Components   │    │  PostgreSQL DB  │
                    └──────────────────┘    └─────────────────┘
                              │                        │
                              ▼                        ▼
                    ┌──────────────────┐    ┌─────────────────┐
                    │  State Mgmt      │    │  Auth System    │
                    └──────────────────┘    └─────────────────┘
                              │                        │
                              ▼                        ▼
                    ┌──────────────────┐    ┌─────────────────┐
                    │  Services/API    │    │  Storage        │
                    └──────────────────┘    └─────────────────┘
```

## Frontend Architecture

### Component Structure

The frontend follows a component-based architecture with clear separation of concerns:

```
src/
├── App.tsx                 # Main application component and routing
├── main.tsx                # Application entry point
├── components/             # Reusable UI components
│   ├── layout/             # Layout components (AppLayout, Header, Sidebar)
│   │   ├── AppLayout.tsx   # Main application layout with sidebar
│   │   ├── Header.tsx      # Top navigation bar
│   │   └── Sidebar.tsx     # Navigation sidebar
│   ├── ui/                 # shadcn/ui components
│   └── ...                 # Feature-specific components
├── pages/                  # Page components for each route
├── hooks/                  # Custom React hooks
├── lib/                    # Utility functions and services
├── locales/                # Internationalization files
└── types/                  # TypeScript type definitions
```

### State Management

Stockwise uses React Context API for state management with a provider pattern:

1. **Auth Context**: Manages user authentication state
2. **Organization Context**: Manages company/organization state
3. **Internationalization Context**: Manages language and translation state
4. **Feature Contexts**: Specific contexts for features like reports

### Routing

The application uses React Router v7 for client-side routing with protected routes:

- Public routes (auth, onboarding)
- Private routes (main application)
- Role-based route protection
- Lazy loading of components

### Data Flow

```
User Action
     │
     ▼
Component Event Handler
     │
     ▼
Service Call (API)
     │
     ▼
Supabase Client
     │
     ▼
Database Operation
     │
     ▼
Response Handling
     │
     ▼
State Update
     │
     ▼
UI Re-render
```

## Backend Architecture

### Supabase Integration

Stockwise leverages Supabase for backend services:

1. **Database**: PostgreSQL with Row Level Security (RLS)
2. **Authentication**: Email/password, magic links, OAuth
3. **Storage**: File storage for company logos and documents
4. **Real-time**: WebSocket connections for live updates
5. **Functions**: Serverless functions for custom logic

### Database Schema

The database schema includes these key tables:

1. **users**: User accounts and profiles
2. **companies**: Business entities
3. **company_members**: User-company relationships with roles
4. **items**: Product/master data
5. **warehouses**: Storage locations
6. **bins**: Storage bins within warehouses
7. **stock_movements**: Inventory transactions
8. **orders**: Purchase and sales orders
9. **order_lines**: Order details
10. **customers**: Customer information
11. **suppliers**: Supplier information
12. **uoms**: Units of measure
13. **uom_conversions**: UoM conversion factors
14. **currencies**: Currency definitions
15. **fx_rates**: Foreign exchange rates
16. **transactions**: Financial transactions
17. **banks**: Bank accounts
18. **bank_statements**: Bank statement records
19. **cash_transactions**: Cash transaction records

### Row Level Security

All tables implement Row Level Security to ensure data isolation between companies:

```sql
-- Example RLS policy
CREATE POLICY "Users can only see their company data"
ON items
FOR ALL
USING (company_id = current_setting('app.company_id')::uuid)
WITH CHECK (company_id = current_setting('app.company_id')::uuid);
```

## Authentication System

### User Roles

Stockwise implements a role-based access control system with these roles:

1. **OWNER**: Full access to all features
2. **ADMIN**: Administrative access
3. **MANAGER**: Management access
4. **OPERATOR**: Operational access
5. **VIEWER**: Read-only access

### Authentication Flow

1. **Sign Up**:
   - User provides email, name, and password
   - System sends verification email
   - User clicks verification link
   - User completes onboarding (creates company)

2. **Sign In**:
   - User provides email and password
   - System validates credentials
   - JWT token is issued
   - User session is established

3. **Session Management**:
   - Tokens are stored in localStorage
   - Automatic token refresh
   - Session persistence across browser restarts

## Internationalization

Stockwise supports multiple languages through a custom i18n implementation:

1. **Language Files**: JSON files for each supported language
2. **Context Provider**: Manages current language and translations
3. **Translation Hook**: Provides translation function to components
4. **Language Switcher**: UI component for language selection

## Real-time Features

Stockwise uses Supabase Real-time for live updates:

1. **Inventory Updates**: Real-time stock level changes
2. **Order Status**: Live order status updates
3. **Notifications**: Real-time notification system
4. **Collaboration**: Multi-user collaboration features

## Security

### Data Protection

1. **Encryption**: Data encryption at rest and in transit
2. **Authentication**: Secure authentication with JWT tokens
3. **Authorization**: Role-based access control
4. **Input Validation**: Client and server-side validation
5. **SQL Injection**: Protection through parameterized queries

### Best Practices

1. **Environment Variables**: Sensitive data stored in environment variables
2. **CORS**: Proper CORS configuration
3. **Rate Limiting**: API rate limiting
4. **Audit Logs**: Activity logging for security monitoring

## Performance

### Optimization Techniques

1. **Code Splitting**: Lazy loading of components
2. **Caching**: Client-side caching of data
3. **Pagination**: Pagination for large datasets
4. **Virtualization**: Virtual scrolling for large lists
5. **Bundle Optimization**: Minification and tree-shaking

### Monitoring

1. **Error Tracking**: Error reporting and monitoring
2. **Performance Metrics**: Performance monitoring
3. **User Analytics**: Usage analytics (privacy-compliant)

## Deployment Architecture

### Production Setup

1. **Frontend**: Vercel for static site hosting
2. **Backend**: Supabase for database and services
3. **CDN**: Content delivery network for assets
4. **Monitoring**: Application performance monitoring
5. **Backup**: Automated database backups

### Scalability

1. **Horizontal Scaling**: Stateless frontend components
2. **Database Scaling**: PostgreSQL scaling options
3. **Caching**: Redis caching layer (future enhancement)
4. **Load Balancing**: CDN and load balancing

## Future Enhancements

### Planned Architecture Improvements

1. **Microservices**: Breaking down monolithic components
2. **Caching Layer**: Redis for improved performance
3. **Message Queue**: Background job processing
4. **Event Sourcing**: Event-driven architecture patterns
5. **AI Integration**: Machine learning for inventory predictions

This architecture document provides a comprehensive overview of the Stockwise system. As the application evolves, this document will be updated to reflect new components and patterns.