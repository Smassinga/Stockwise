# Stockwise Frontend Components

This document provides an overview of the React components used in Stockwise, organized by category and functionality.

## Component Structure

The components are organized in the following structure:

```
src/
├── components/
│   ├── layout/          # Layout components
│   ├── ui/              # Reusable UI components (shadcn/ui)
│   ├── brand/           # Brand-specific components
│   ├── docs/            # Documentation components
│   ├── notifications/   # Notification components
│   ├── settings/        # Settings components
│   └── ...              # Feature-specific components
```

## Layout Components

### AppLayout

The main application layout component that provides the overall structure including sidebar navigation, header, and main content area.

**Props:**
- `user`: Current user object
- `children`: Child components to render in the main content area

**Features:**
- Responsive sidebar navigation
- User profile dropdown
- Company switcher
- Theme toggle
- Sign out functionality

### Header

The top navigation bar that appears on all pages within the application.

**Features:**
- Mobile menu toggle
- Search functionality
- Notification center
- Company switcher
- User menu

### Sidebar

The main navigation sidebar that provides access to all application features.

**Features:**
- Navigation links organized by feature
- Role-based visibility of navigation items
- Company information display
- User information display

## UI Components

Stockwise uses shadcn/ui components which are built on top of Radix UI primitives and styled with Tailwind CSS. These components include:

### Form Components

- `Button`: Interactive buttons with multiple variants
- `Input`: Text input fields
- `Textarea`: Multi-line text input
- `Select`: Dropdown selection component
- `Checkbox`: Checkbox input
- `RadioGroup`: Radio button group
- `Switch`: Toggle switch
- `Slider`: Range slider

### Display Components

- `Card`: Content container with header and body
- `Alert`: Alert messages with different styles
- `Badge`: Small status indicators
- `Avatar`: User profile images or initials
- `Tooltip`: Contextual help text
- `Popover`: Pop-up content containers
- `Dialog`: Modal dialog windows
- `Tabs`: Tabbed interface components

### Data Components

- `Table`: Data table with sorting and pagination
- `Pagination`: Page navigation controls
- `Skeleton`: Loading state placeholders
- `Progress`: Progress indicators

## Feature Components

### Authentication Components

#### Auth

The main authentication page that handles both sign in and sign up flows.

**Features:**
- Email/password authentication
- Form validation
- Loading states
- Error handling
- Switch between sign in and sign up

#### AuthCallback

Handles authentication callbacks from Supabase, particularly for email verification and OAuth flows.

#### AcceptInvite

Handles user invitation acceptance flow.

#### Onboarding

Guides new users through the company creation process after initial sign up.

### Dashboard Components

#### Dashboard

The main dashboard page that displays key metrics and summaries.

**Features:**
- KPI cards for inventory value, revenue, COGS, and gross margin
- Low stock alerts
- Top products by gross margin
- Recent movements list
- Date range filtering

### Inventory Components

#### Items

Manages item master data including creation, editing, and listing.

**Features:**
- Item listing with search and filtering
- Item creation form
- Item editing capabilities
- SKU uniqueness validation

#### StockMovements

Handles all stock movement operations including receiving, issuing, transferring, and adjusting inventory.

**Features:**
- Movement type selection (receive, issue, transfer, adjust)
- Bin selection for source and destination
- Item search and selection
- UoM conversion support
- Real-time stock level updates

#### Warehouses

Manages warehouse and bin configuration.

**Features:**
- Warehouse listing and creation
- Bin management within warehouses
- Warehouse editing and deletion
- Stock level validation before deletion

#### StockLevels

Displays current stock levels by item and warehouse.

**Features:**
- Searchable stock level listing
- Filtering by warehouse
- Low stock highlighting
- Export functionality

### Order Components

#### Orders

Main order management page with tabs for purchase orders and sales orders.

**Features:**
- Order listing with status filtering
- Order creation forms
- Order approval workflows
- Order fulfillment (receiving/shipping)

#### PurchaseOrders

Specific functionality for purchase order management.

**Features:**
- PO creation with line items
- Supplier selection
- Currency and FX rate support
- Expected date tracking

#### SalesOrders

Specific functionality for sales order management.

**Features:**
- SO creation with line items
- Customer selection
- Currency and FX rate support
- Expected ship date tracking

### Reporting Components

#### Reports

Main reporting interface with multiple report tabs.

**Features:**
- Date range filtering
- Costing method selection (WA/FIFO)
- Currency selection and FX rate management
- Tabbed interface for different report types

#### SummaryTab

Provides a high-level summary of key metrics.

**Features:**
- Revenue and COGS calculations
- Gross margin analysis
- Inventory valuation
- Export functionality

#### ValuationTab

Detailed inventory valuation reports.

**Features:**
- Item-level valuation
- Costing method application
- Valuation timing options
- Export to CSV

#### TurnoverTab

Inventory turnover analysis.

**Features:**
- Turnover rate calculations
- Item ranking by turnover
- Time period analysis
- Export functionality

#### AgingTab

Inventory aging analysis.

**Features:**
- Age bucket categorization
- Item aging tracking
- Warehouse-level analysis
- Export to CSV

#### RevenueTab

Revenue analysis by product and period.

**Features:**
- Product-level revenue tracking
- Gross margin calculations
- Time period filtering
- Export functionality

#### SuppliersTab

Supplier statement and performance reports.

**Features:**
- Supplier transaction history
- Outstanding balances
- Payment tracking
- Export functionality

#### CustomersTab

Customer statement and performance reports.

**Features:**
- Customer transaction history
- Outstanding balances
- Payment tracking
- Export functionality

### Financial Components

#### Transactions

General transaction listing and management.

**Features:**
- Transaction search and filtering
- Reference type categorization
- Currency support
- Export functionality

#### Cash

Cash transaction management.

**Features:**
- Cash transaction recording
- Beginning/ending balance tracking
- Cash flow analysis
- Transaction approval workflows

#### Banks

Bank account management and reconciliation.

**Features:**
- Bank account listing and creation
- Statement upload and management
- Transaction reconciliation
- Balance tracking

#### Currency

Currency and FX rate management.

**Features:**
- Allowed currency configuration
- FX rate entry and management
- Base currency selection
- Rate history tracking

### Master Data Components

#### Customers

Customer master data management.

**Features:**
- Customer listing and creation
- Contact information management
- Billing/shipping address storage
- Payment terms configuration

#### Suppliers

Supplier master data management.

**Features:**
- Supplier listing and creation
- Contact information management
- Address storage
- Payment terms configuration
- Status management (active/inactive)

#### UomSettings

Unit of measure configuration and conversion management.

**Features:**
- UoM creation and management
- Conversion factor setup
- Conversion path testing
- Family-based validation

### Settings Components

#### Settings

Main settings page with multiple configuration sections.

**Features:**
- Company profile management
- User management
- Warehouse configuration
- UoM setup
- Localization settings

#### Users

User management within the company.

**Features:**
- User listing with roles
- User invitation functionality
- Role assignment
- Member status management

## Custom Hooks

### useAuth

Manages authentication state and provides authentication functions.

**Functions:**
- `login`: Authenticate user with email/password
- `register`: Register new user account
- `logout`: Sign out current user
- `requestPasswordReset`: Initiate password reset flow

### useOrg

Manages organization/company state and membership information.

**Functions:**
- `refresh`: Refresh organization data
- `setActiveCompany`: Switch active company
- `companies`: List of user's companies

### useI18n

Manages internationalization and translation functionality.

**Functions:**
- `t`: Translation function
- `setLang`: Language switching
- `lang`: Current language

### useToast

Manages toast notifications throughout the application.

**Functions:**
- `toast`: Display toast notification

## Utility Components

### ErrorBoundary

Catches JavaScript errors in child components and displays fallback UI.

### ThemeToggle

Provides light/dark theme switching functionality.

### CompanySwitcher

Allows users to switch between companies they belong to.

### NotificationCenter

Manages notification display and management.

## Component Design Principles

### Reusability

Components are designed to be reusable across different parts of the application with appropriate props for customization.

### Accessibility

All components follow accessibility best practices including:
- Proper semantic HTML
- Keyboard navigation support
- ARIA attributes where needed
- Color contrast compliance

### Responsiveness

Components are designed to work on all screen sizes using responsive design principles:
- Mobile-first approach
- Flexible layouts
- Adaptive component behavior

### Performance

Components are optimized for performance:
- Memoization where appropriate
- Lazy loading for heavy components
- Efficient re-rendering
- Minimal DOM footprint

This component documentation provides a comprehensive overview of the frontend architecture and component usage in Stockwise.