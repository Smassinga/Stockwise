# Stockwise Features Overview

Stockwise is a comprehensive inventory management system designed for businesses of all sizes. This document provides a detailed overview of all currently implemented features, their purpose, functionality, and technical details.

## Table of Contents

1. [System Overview](#system-overview)
2. [Core Features](#core-features)
   - [Authentication & User Management](#authentication--user-management)
   - [Multi-Company Support](#multi-company-support)
   - [Role-Based Access Control](#role-based-access-control)
   - [Internationalization](#internationalization)
3. [Inventory Management](#inventory-management)
   - [Items Management](#items-management)
   - [Warehouses & Bins](#warehouses--bins)
   - [Stock Movements](#stock-movements)
   - [Units of Measure](#units-of-measure)
4. [Order Management](#order-management)
   - [Purchase Orders](#purchase-orders)
   - [Sales Orders](#sales-orders)
5. [Financial Management](#financial-management)
   - [Transactions](#transactions)
   - [Cash Management](#cash-management)
   - [Banking](#banking)
   - [Currency & FX Management](#currency--fx-management)
6. [Reporting & Analytics](#reporting--analytics)
7. [Master Data Management](#master-data-management)
   - [Customers](#customers)
   - [Suppliers](#suppliers)
8. [Real-time Features](#real-time-features)
9. [Mobile Optimization](#mobile-optimization)
10. [Desktop Application](#desktop-application)
11. [Technical Architecture](#technical-architecture)

## System Overview

Stockwise is a modern inventory management system built with a client-server architecture using React with TypeScript on the frontend and Supabase as the backend platform. The system provides comprehensive inventory tracking, order management, financial tracking, and reporting capabilities.

Key technical components:
- **Frontend**: React with TypeScript, Vite build system, Tailwind CSS for styling
- **UI Components**: shadcn/ui component library
- **Backend**: Supabase (PostgreSQL database with Row Level Security)
- **Real-time**: WebSocket connections for live updates
- **Authentication**: Email/password authentication with session management
- **Mobile Support**: Responsive design optimized for all device sizes
- **Desktop**: Tauri framework for native desktop applications

## Core Features

### Authentication & User Management

Stockwise provides a complete authentication system with user registration, login, and password reset functionality.

**Features:**
- Email/password authentication
- Email verification workflow
- Password reset functionality
- User profile management
- Session persistence across browser sessions

**Technical Details:**
- Built on Supabase Auth
- Secure JWT token management
- Automatic token refresh
- Protected route system in React Router

### Multi-Company Support

Stockwise supports multiple companies within a single instance, allowing users to belong to and switch between different organizations.

**Features:**
- User can belong to multiple companies
- Company switching functionality
- Persistent company selection
- Cross-tab synchronization of company selection

**Technical Details:**
- Company context stored in localStorage with user-specific keys
- JWT claims for company identification
- Database session context via RPC calls
- Real-time synchronization across browser tabs

### Role-Based Access Control

Stockwise implements a comprehensive role-based access control system with five distinct roles:

1. **OWNER**: Full access to all features
2. **ADMIN**: Administrative access
3. **MANAGER**: Management access
4. **OPERATOR**: Operational access
5. **VIEWER**: Read-only access

**Permissions by Role:**
- **OWNER**: All operations permitted
- **ADMIN**: All operations except OWNER-specific functions
- **MANAGER**: Create/update items, create movements, manage master data, export reports, manage users and warehouses
- **OPERATOR**: Create/update items, create movements, manage master data, export reports
- **VIEWER**: View-only access with report export capability

### Internationalization

Stockwise supports multiple languages with a built-in i18n system.

**Supported Languages:**
- English (default)
- Portuguese

**Features:**
- Language switching functionality
- Comprehensive translation system
- Context-aware translations
- Language preference persistence

**Technical Details:**
- JSON-based translation files
- React Context API for state management
- Dynamic language switching without page reload

## Inventory Management

### Items Management

Stockwise provides comprehensive item master data management.

**Features:**
- Item creation with SKU, name, and base unit of measure
- Minimum stock level configuration
- Item listing with search and filtering
- Item editing capabilities
- SKU uniqueness validation

**Technical Details:**
- Base UoM association for each item
- Stock level tracking by warehouse and bin
- Integration with stock movements

### Warehouses & Bins

Stockwise supports hierarchical inventory organization with warehouses and bins.

**Features:**
- Warehouse creation and management
- Bin creation within warehouses
- Warehouse editing and deletion
- Stock level validation before deletion
- Searchable warehouse listing

**Technical Details:**
- Hierarchical structure (Warehouse → Bins)
- Stock level tracking at bin level
- Integration with stock movements

### Stock Movements

Stockwise handles all types of inventory movements with comprehensive tracking.

**Movement Types:**
1. **Receive**: Add inventory to a warehouse/bin
2. **Issue**: Remove inventory from a warehouse/bin
3. **Transfer**: Move inventory between bins/warehouses
4. **Adjust**: Adjust inventory levels (increase or decrease)

**Features:**
- Movement type selection
- Source and destination warehouse/bin selection
- Item search and selection
- Unit of measure conversion support
- Reference tagging (PO, SO, ADJUST, TRANSFER)
- Notes and description fields
- Real-time stock level updates

**Technical Details:**
- Base unit of measure conversions
- Cost tracking with average cost calculation
- Integration with sales order processing
- Automatic stock level updates via database triggers

### Units of Measure

Stockwise provides flexible unit of measure management with conversion capabilities.

**Features:**
- UoM creation with code, name, and family
- Conversion factor setup between units
- Conversion path testing
- Family-based validation
- Quick testing of conversions

**Technical Details:**
- Graph-based conversion system
- Bidirectional conversion support
- Family grouping for validation
- BFS algorithm for conversion path finding

## Order Management

### Purchase Orders

Stockwise provides comprehensive purchase order management.

**Features:**
- PO creation with supplier selection
- Line item management with UoM support
- Currency and FX rate support
- Expected date tracking
- Order approval workflows
- Order receiving functionality
- Status tracking (draft, submitted, confirmed, allocated, shipped, closed, cancelled)

**Technical Details:**
- Integration with stock movements for receiving
- Currency conversion support
- Automatic total calculation
- Status transition controls

### Sales Orders

Stockwise provides comprehensive sales order management.

**Features:**
- SO creation with customer selection
- Line item management with UoM support
- Currency and FX rate support
- Expected ship date tracking
- Order confirmation workflows
- Order shipping functionality
- Status tracking (draft, submitted, confirmed, allocated, shipped, closed, cancelled)
- Cash sale processing with automatic COGS recording

**Technical Details:**
- Integration with stock movements for shipping
- Currency conversion support
- Automatic total calculation
- COGS (Cost of Goods Sold) tracking
- Status transition controls

## Financial Management

### Transactions

Stockwise tracks all financial transactions with comprehensive categorization.

**Features:**
- Transaction creation with reference types
- Currency support
- FX rate management
- Memo/description fields
- Searchable transaction listing

**Technical Details:**
- Reference type categorization (SO, PO, CASH, etc.)
- Integration with order processing
- Currency conversion support

### Cash Management

Stockwise provides cash transaction management with approval workflows.

**Features:**
- Cash transaction recording (inflows and outflows)
- Beginning/ending balance tracking
- Cash flow analysis
- Transaction approval workflows
- Status tracking (awaiting, posted)

**Technical Details:**
- Running balance calculation
- Approval workflow integration
- Cash flow categorization

### Banking

Stockwise supports bank account management and reconciliation.

**Features:**
- Bank account creation and management
- Statement upload and management
- Transaction reconciliation
- Balance tracking
- Statement date tracking

**Technical Details:**
- File upload support for statements
- Reconciliation status tracking
- Balance validation

### Currency & FX Management

Stockwise supports multi-currency operations with FX rate management.

**Features:**
- Base currency configuration
- Allowed currency setup
- FX rate entry and management
- Rate history tracking
- Automatic FX rate application

**Technical Details:**
- Base currency selection per company
- FX rate date tracking
- Automatic rate application in reports

## Reporting & Analytics

Stockwise provides comprehensive reporting capabilities across multiple dimensions.

**Report Types:**
1. **Summary**: High-level KPIs and metrics
2. **Valuation**: Inventory valuation by warehouse
3. **Turnover**: Inventory turnover analysis
4. **Aging**: Inventory aging analysis
5. **Revenue**: Revenue analysis by product
6. **Suppliers**: Supplier statement and performance
7. **Customers**: Customer statement and performance

**Key Metrics:**
- Inventory value
- Revenue
- COGS (Cost of Goods Sold)
- Gross margin
- Inventory turns
- Days to sell
- Best/worst selling products

**Features:**
- Date range filtering
- Costing method selection (Weighted Average, FIFO)
- Currency selection and FX rate management
- Export to CSV functionality
- Real-time data updates

**Technical Details:**
- Multiple costing methods supported
- Currency conversion in reports
- Performance optimized queries
- Export functionality for all reports

## Master Data Management

### Customers

Stockwise provides comprehensive customer management.

**Features:**
- Customer creation with code and name
- Contact information management
- Billing/shipping address storage
- Payment terms configuration
- Currency preference
- Notes field
- Status management (active/inactive)

**Technical Details:**
- Unique customer code per company
- Integration with sales orders
- Address management

### Suppliers

Stockwise provides comprehensive supplier management.

**Features:**
- Supplier creation with code and name
- Contact information management
- Address storage
- Payment terms configuration
- Currency preference
- Notes field
- Status management (active/inactive)

**Technical Details:**
- Unique supplier code per company
- Integration with purchase orders
- Address management

## Real-time Features

Stockwise leverages Supabase Real-time for live updates and notifications.

**Features:**
- Real-time inventory updates
- Live order status changes
- Notification system
- Cross-user collaboration

**Technical Details:**
- WebSocket connections
- Channel-based subscriptions
- JWT token authentication for channels
- Automatic reconnection handling

## Mobile Optimization

Stockwise is designed with a mobile-first approach and includes comprehensive mobile optimization.

**Features:**
- Responsive layout for all screen sizes
- Touch-friendly controls with appropriate sizing
- Mobile-optimized navigation
- Performance optimization for mobile networks
- Accessibility compliance

**Technical Details:**
- Mobile-first CSS approach
- Touch target optimization (minimum 44px)
- Responsive grid layouts
- Adaptive component behavior

## Desktop Application

Stockwise supports native desktop applications through the Tauri framework.

**Features:**
- Native desktop installers for Windows, macOS, and Linux
- System API access
- Offline capabilities
- Native file system integration

**Technical Details:**
- Tauri 2.x framework
- Rust-based backend
- Cross-platform support
- System tray integration

## Technical Architecture

### Frontend Architecture

**Component Structure:**
```
src/
├── App.tsx                 # Main application component and routing
├── main.tsx                # Application entry point
├── components/             # Reusable UI components
│   ├── layout/             # Layout components (AppLayout, Header, Sidebar)
│   ├── ui/                 # shadcn/ui components
│   └── ...                 # Feature-specific components
├── pages/                  # Page components for each route
├── hooks/                  # Custom React hooks
├── lib/                    # Utility functions and services
├── locales/                # Internationalization files
└── types/                  # TypeScript type definitions
```

**State Management:**
- React Context API for global state
- Custom hooks for business logic
- Local component state for UI concerns

**Routing:**
- React Router v7 for client-side routing
- Protected routes with role-based access control
- Lazy loading of components

### Backend Architecture

**Supabase Integration:**
- PostgreSQL database with Row Level Security
- Authentication via Supabase Auth
- Real-time via Supabase Realtime
- Storage for file uploads
- Serverless functions for custom logic

**Database Schema:**
Key tables include:
- users: User accounts and profiles
- companies: Business entities
- company_members: User-company relationships with roles
- items: Product/master data
- warehouses: Storage locations
- bins: Storage bins within warehouses
- stock_movements: Inventory transactions
- orders: Purchase and sales orders
- order_lines: Order details
- customers: Customer information
- suppliers: Supplier information
- uoms: Units of measure
- uom_conversions: UoM conversion factors
- currencies: Currency definitions
- fx_rates: Foreign exchange rates
- transactions: Financial transactions
- banks: Bank accounts
- bank_statements: Bank statement records
- cash_transactions: Cash transaction records

**Row Level Security:**
All tables implement Row Level Security to ensure data isolation between companies using policies like:
```sql
CREATE POLICY "Users can only see their company data"
ON items
FOR ALL
USING (company_id = current_setting('app.company_id')::uuid)
WITH CHECK (company_id = current_setting('app.company_id')::uuid);
```

### Security

**Data Protection:**
- Encryption at rest and in transit
- Secure authentication with JWT tokens
- Role-based access control
- Input validation on client and server
- SQL injection protection through parameterized queries

**Best Practices:**
- Environment variables for sensitive data
- Proper CORS configuration
- Rate limiting for API endpoints
- Audit logging for security monitoring

### Performance

**Optimization Techniques:**
- Code splitting with lazy loading
- Client-side caching
- Pagination for large datasets
- Virtualization for large lists
- Bundle optimization with minification

**Monitoring:**
- Error tracking and reporting
- Performance metrics collection
- User analytics (privacy-compliant)

This comprehensive feature overview provides a detailed understanding of the Stockwise inventory management system's capabilities, implementation details, and technical architecture.