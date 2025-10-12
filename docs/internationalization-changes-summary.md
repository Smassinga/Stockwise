# Internationalization Changes Summary

This document summarizes the internationalization changes made to the Stockwise application to support both English and Portuguese languages in the Sales Orders, Settings, and Notification components.

## Files Modified

### 1. Locale Files
- `src/locales/en.json` - Added English translations and fixed duplicate keys
- `src/locales/pt.json` - Added Portuguese translations and fixed duplicate keys

### 2. Component Files
- `src/pages/Orders/SalesOrders.tsx` - Added internationalization for hardcoded strings
- `src/pages/Settings.tsx` - Added internationalization for hardcoded strings
- `src/components/notifications/NotificationCenter.tsx` - Added internationalization for hardcoded strings

## Fixes Made

### Duplicate Keys Removal
- Removed 28 duplicate keys from `src/locales/en.json`
- Removed duplicate keys from `src/locales/pt.json`
- Both files now have consistent key sets with no duplicates

## New Translation Keys Added

### Sales Orders
- `orders.dueDate` - "Due Date"
- `orders.download` - "Download"
- `orders.allLinesShipped` - "All lines shipped."
- `orders.shippedBrowser` - "Shipped Sales Orders"
- `orders.shippedBrowserDesc` - "Search, filter and print shipped/closed orders"
- `orders.searchHint` - "Order no. or customer"
- `orders.from` - "From (updated)"
- `orders.to` - "To (updated)"
- `orders.statuses` - "Statuses"
- `orders.noResults` - "No results"
- `orders.rows` - "Rows"

### Settings
- `settings.companyProfile.emailSubjectPrefix` - "Email subject prefix (optional)"
- `settings.companyProfile.emailSubjectPrefix.placeholder` - "e.g. Munchythief, Lda"
- `settings.companyProfile.emailSubjectPrefix.helper` - "Used at the start of reminder subjects. Falls back to Trade/Legal/Company name."
- `settings.companyProfile.preferredLang` - "Preferred language for customer emails"
- `settings.companyProfile.preferredLang.auto` - "Auto (based on country)"
- `settings.companyProfile.preferredLang.helper` - "Used by reminders/digests. If empty, we guess from the company's country."
- `settings.revenueSources.title` - "Revenue Sources"
- `settings.revenueSources.ordersSource` - "Orders / Invoices source (table or view name)"
- `settings.revenueSources.ordersSource.placeholder` - "e.g. "sales_orders" or "orders_view""
- `settings.revenueSources.ordersSource.helper` - "Table/view should include: id, customer_id/customerId, status, currency_code/currencyCode, total/grand_total/net_total, and a date column created_at/createdAt."
- `settings.revenueSources.cashSales` - "Cash / POS sales source (table or view)"
- `settings.revenueSources.cashSales.placeholder` - "e.g. "cash_sales_view""
- `settings.revenueSources.dateCol` - "Date column"
- `settings.revenueSources.dateCol.placeholder` - "created_at"
- `settings.revenueSources.customerCol` - "Customer column"
- `settings.revenueSources.customerCol.placeholder` - "customer_id"
- `settings.revenueSources.amountCol` - "Amount column"
- `settings.revenueSources.amountCol.placeholder` - "amount"
- `settings.revenueSources.currencyCol` - "Currency column (optional)"
- `settings.revenueSources.currencyCol.placeholder` - "currency_code"
- `settings.revenueSources.cashSales.helper` - "We'll include walk-in/cash sales in Reports → Revenue and in the Daily Digest."
- `settings.dueReminders.title` - "Due Reminder Worker"
- `settings.dueReminders.enable` - "Enable Due Reminder Worker"
- `settings.dueReminders.timezone` - "Timezone"
- `settings.dueReminders.timezone.placeholder` - "e.g. Africa/Maputo"
- `settings.dueReminders.timezone.helper` - "Timezone for calculating due dates"
- `settings.dueReminders.hours` - "Send SO due reminders at"
- `settings.dueReminders.hours.helper` - "Time of day to send due reminders"
- `settings.dueReminders.leadDays` - "Lead Days"
- `settings.dueReminders.leadDays.placeholder` - "e.g. 3,1,0,-3"
- `settings.dueReminders.leadDays.helper` - "Days before/after due date to send reminders (negative for overdue)"
- `settings.dueReminders.recipients` - "Recipient Emails"
- `settings.dueReminders.recipients.placeholder` - "email1@example.com, email2@example.com"
- `settings.dueReminders.recipients.helper` - "Override customer emails (comma-separated). Leave empty to use customer emails."
- `settings.dueReminders.bcc` - "BCC Emails"
- `settings.dueReminders.bcc.placeholder` - "bcc1@example.com, bcc2@example.com"
- `settings.dueReminders.bcc.helper` - "BCC recipients for all reminder emails (comma-separated)"
- `settings.dueReminders.invoiceBaseUrl` - "Invoice Base URL"
- `settings.dueReminders.invoiceBaseUrl.placeholder` - "https://app.stockwise.app/invoices"
- `settings.dueReminders.invoiceBaseUrl.helper` - "Base URL for invoice links (will append invoice code)"

### Notifications
- `notifications.title` - "Notifications"
- `notifications.noNotifications` - "No notifications."
- `notifications.open` - "Open"
- `notifications.realtime.connecting` - "Realtime: connecting…"
- `notifications.realtime.on` - "Realtime: on"
- `notifications.showingLatest` - "Showing latest {count}"
- `notifications.markAllRead` - "Mark all as read"

## Implementation Details

### Sales Orders Component
- Replaced hardcoded strings with `tt()` function calls for translation
- Added "Due Date" field to the sales order creation form
- Added "Download" button for downloading sales orders as HTML files
- Improved error handling for print functionality

### Settings Component
- Replaced all hardcoded strings with `t()` function calls for translation
- Added proper internationalization for all form labels, placeholders, and helper text
- Maintained consistent styling and layout

### Notification Center Component
- Added `useI18n()` hook to access translation functions
- Replaced all hardcoded strings with `t()` function calls
- Added proper aria-labels and titles for accessibility

## Testing

The changes have been implemented following the existing internationalization pattern used throughout the application. All new translation keys have been added to both English and Portuguese locale files with appropriate translations.

The implementation maintains backward compatibility and follows the existing code style and patterns.

## Verification

- Both locale files have been cleaned of duplicate keys
- All keys in the English file have corresponding translations in the Portuguese file
- No syntax errors in either locale file
- All new translation keys are properly integrated into the application components