# Stockwise API Documentation

This document describes the API endpoints and data structures used in Stockwise. While Stockwise primarily uses Supabase as its backend, this documentation covers the key operations and data interactions.

## Authentication API

### Sign Up

**Endpoint:** `POST /auth/v1/signup`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "options": {
    "data": {
      "name": "John Doe"
    }
  }
}
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "session": {
    "access_token": "jwt_token",
    "refresh_token": "refresh_token"
  }
}
```

### Sign In

**Endpoint:** `POST /auth/v1/token?grant_type=password`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "access_token": "jwt_token",
  "refresh_token": "refresh_token",
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

### Sign Out

**Endpoint:** `POST /auth/v1/logout`

**Response:**
```json
{
  "message": "Successfully logged out"
}
```

## User Management

### Get Current User

**Endpoint:** `GET /auth/v1/user`

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "created_at": "2023-01-01T00:00:00Z"
}
```

### Update User

**Endpoint:** `PUT /auth/v1/user`

**Request Body:**
```json
{
  "data": {
    "name": "Jane Doe"
  }
}
```

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "Jane Doe"
}
```

## Company Management

### Get Companies for User

**Endpoint:** `GET /rest/v1/companies?select=*&company_members.user_id=eq.{user_id}`

**Response:**
```json
[
  {
    "id": "uuid",
    "trade_name": "ABC Company",
    "legal_name": "ABC Company Ltd",
    "created_at": "2023-01-01T00:00:00Z"
  }
]
```

### Create Company

**Endpoint:** `POST /rest/v1/companies`

**Request Body:**
```json
{
  "trade_name": "New Company",
  "legal_name": "New Company Ltd",
  "base_currency": "USD"
}
```

**Response:**
```json
{
  "id": "uuid",
  "trade_name": "New Company",
  "legal_name": "New Company Ltd",
  "base_currency": "USD",
  "created_at": "2023-01-01T00:00:00Z"
}
```

### Update Company

**Endpoint:** `PATCH /rest/v1/companies?id=eq.{company_id}`

**Request Body:**
```json
{
  "trade_name": "Updated Company Name"
}
```

**Response:**
```json
{
  "id": "uuid",
  "trade_name": "Updated Company Name",
  "legal_name": "New Company Ltd",
  "base_currency": "USD",
  "updated_at": "2023-01-02T00:00:00Z"
}
```

## Item Management

### Get Items

**Endpoint:** `GET /rest/v1/items?select=*&company_id=eq.{company_id}`

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Product A",
    "sku": "PROD-A",
    "base_uom_id": "uuid",
    "min_stock": 10,
    "created_at": "2023-01-01T00:00:00Z"
  }
]
```

### Create Item

**Endpoint:** `POST /rest/v1/items`

**Request Body:**
```json
{
  "company_id": "uuid",
  "name": "New Product",
  "sku": "NEW-PROD",
  "base_uom_id": "uuid",
  "min_stock": 5
}
```

**Response:**
```json
{
  "id": "uuid",
  "company_id": "uuid",
  "name": "New Product",
  "sku": "NEW-PROD",
  "base_uom_id": "uuid",
  "min_stock": 5,
  "created_at": "2023-01-01T00:00:00Z"
}
```

### Update Item

**Endpoint:** `PATCH /rest/v1/items?id=eq.{item_id}`

**Request Body:**
```json
{
  "min_stock": 15
}
```

**Response:**
```json
{
  "id": "uuid",
  "name": "Product A",
  "sku": "PROD-A",
  "min_stock": 15,
  "updated_at": "2023-01-02T00:00:00Z"
}
```

### Delete Item

**Endpoint:** `DELETE /rest/v1/items?id=eq.{item_id}`

**Response:**
```json
{
  "message": "Item deleted successfully"
}
```

## Warehouse Management

### Get Warehouses

**Endpoint:** `GET /rest/v1/warehouses?select=*&company_id=eq.{company_id}`

**Response:**
```json
[
  {
    "id": "uuid",
    "company_id": "uuid",
    "code": "WH1",
    "name": "Main Warehouse",
    "created_at": "2023-01-01T00:00:00Z"
  }
]
```

### Create Warehouse

**Endpoint:** `POST /rest/v1/warehouses`

**Request Body:**
```json
{
  "company_id": "uuid",
  "code": "WH2",
  "name": "Secondary Warehouse"
}
```

**Response:**
```json
{
  "id": "uuid",
  "company_id": "uuid",
  "code": "WH2",
  "name": "Secondary Warehouse",
  "created_at": "2023-01-01T00:00:00Z"
}
```

## Stock Movement API

### Get Stock Movements

**Endpoint:** `GET /rest/v1/stock_movements?select=*&company_id=eq.{company_id}&order=created_at.desc`

**Response:**
```json
[
  {
    "id": "uuid",
    "company_id": "uuid",
    "item_id": "uuid",
    "from_bin_id": "uuid",
    "to_bin_id": "uuid",
    "qty": 100,
    "uom_id": "uuid",
    "unit_cost": 5.50,
    "ref_type": "PO",
    "ref_id": "uuid",
    "created_at": "2023-01-01T00:00:00Z"
  }
]
```

### Create Stock Movement

**Endpoint:** `POST /rest/v1/stock_movements`

**Request Body:**
```json
{
  "company_id": "uuid",
  "item_id": "uuid",
  "to_bin_id": "uuid",
  "qty": 100,
  "uom_id": "uuid",
  "unit_cost": 5.50,
  "ref_type": "PO",
  "ref_id": "uuid"
}
```

**Response:**
```json
{
  "id": "uuid",
  "company_id": "uuid",
  "item_id": "uuid",
  "to_bin_id": "uuid",
  "qty": 100,
  "uom_id": "uuid",
  "unit_cost": 5.50,
  "ref_type": "PO",
  "ref_id": "uuid",
  "created_at": "2023-01-01T00:00:00Z"
}
```

## Order Management

### Get Orders

**Endpoint:** `GET /rest/v1/orders?select=*,order_lines(*)&company_id=eq.{company_id}&order=created_at.desc`

**Response:**
```json
[
  {
    "id": "uuid",
    "company_id": "uuid",
    "type": "PO",
    "ref_no": "PO-001",
    "supplier_id": "uuid",
    "currency_code": "USD",
    "total_amount": 1000.00,
    "status": "pending",
    "created_at": "2023-01-01T00:00:00Z",
    "order_lines": [
      {
        "id": "uuid",
        "order_id": "uuid",
        "item_id": "uuid",
        "qty": 100,
        "unit_price": 10.00,
        "line_total": 1000.00
      }
    ]
  }
]
```

### Create Order

**Endpoint:** `POST /rest/v1/orders`

**Request Body:**
```json
{
  "company_id": "uuid",
  "type": "PO",
  "ref_no": "PO-002",
  "supplier_id": "uuid",
  "currency_code": "USD",
  "total_amount": 500.00,
  "status": "pending"
}
```

**Response:**
```json
{
  "id": "uuid",
  "company_id": "uuid",
  "type": "PO",
  "ref_no": "PO-002",
  "supplier_id": "uuid",
  "currency_code": "USD",
  "total_amount": 500.00,
  "status": "pending",
  "created_at": "2023-01-01T00:00:00Z"
}
```

### Update Order Status

**Endpoint:** `PATCH /rest/v1/orders?id=eq.{order_id}`

**Request Body:**
```json
{
  "status": "approved"
}
```

**Response:**
```json
{
  "id": "uuid",
  "status": "approved",
  "updated_at": "2023-01-02T00:00:00Z"
}
```

## Reporting API

### Get Inventory Summary

**Endpoint:** `GET /rest/v1/rpc/get_inventory_summary?company_id=eq.{company_id}`

**Response:**
```json
[
  {
    "item_id": "uuid",
    "item_name": "Product A",
    "sku": "PROD-A",
    "total_qty": 500,
    "total_value": 2750.00
  }
]
```

### Get Stock Movements Report

**Endpoint:** `GET /rest/v1/rpc/get_stock_movements_report?company_id=eq.{company_id}&start_date=eq.2023-01-01&end_date=eq.2023-01-31`

**Response:**
```json
[
  {
    "date": "2023-01-01",
    "item_id": "uuid",
    "item_name": "Product A",
    "sku": "PROD-A",
    "movement_type": "receive",
    "qty": 100,
    "value": 550.00
  }
]
```

## Real-time Subscriptions

### Subscribe to Items Changes

```javascript
const subscription = supabase
  .channel('items-changes')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'items'
    },
    (payload) => {
      console.log('New item created:', payload.new)
    }
  )
  .subscribe()
```

### Subscribe to Stock Movements

```javascript
const subscription = supabase
  .channel('stock-movements')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'stock_movements'
    },
    (payload) => {
      console.log('New stock movement:', payload.new)
    }
  )
  .subscribe()
```

## Error Handling

All API responses follow standard HTTP status codes:

- `200`: Success
- `201`: Created
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `500`: Internal Server Error

Error responses follow this format:
```json
{
  "error": {
    "code": "error_code",
    "message": "Human readable error message",
    "details": "Additional error details"
  }
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse:

- 1000 requests per hour per IP
- 100 requests per minute per IP

Exceeding these limits will result in a 429 (Too Many Requests) response.

## Data Validation

All endpoints perform data validation:

1. **Required Fields**: All required fields must be present
2. **Data Types**: Fields must match expected data types
3. **Unique Constraints**: Unique fields must not conflict
4. **Foreign Key Constraints**: Referenced records must exist
5. **Business Rules**: Application-specific validation rules

## Pagination

List endpoints support pagination:

**Query Parameters:**
- `limit`: Number of records to return (default: 100, max: 1000)
- `offset`: Number of records to skip

**Response Headers:**
- `Content-Range`: Indicates the range of records returned
- `Accept-Ranges`: Indicates pagination is supported

## Filtering

List endpoints support filtering through query parameters:

**Examples:**
- `?name=eq.John`: Exact match
- `?name=ilike.*john*`: Case-insensitive partial match
- `?created_at=gte.2023-01-01`: Greater than or equal
- `?status=in.(active,pending)`: In list

## Sorting

List endpoints support sorting through the `order` parameter:

**Examples:**
- `?order=created_at.desc`: Sort by created_at descending
- `?order=name.asc,created_at.desc`: Sort by name ascending, then created_at descending

This API documentation provides a comprehensive overview of how to interact with the Stockwise backend services through the Supabase platform.