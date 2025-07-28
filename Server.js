require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.get('/api/customers', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM customers');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/customers', async (req, res) => {
    const { name, phone, email } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO customers (name, phone, email) VALUES ($1, $2, $3) RETURNING *',
            [name, phone, email]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/inventory', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM inventory');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/inventory', async (req, res) => {
    const { name, price, stock } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO inventory (name, price, stock) VALUES ($1, $2, $3) RETURNING *',
            [name, price, stock]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/invoices', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                invoices.*,
                customers.name as customer_name,
                customers.phone as customer_phone,
                customers.email as customer_email
            FROM invoices
            JOIN customers ON invoices.customer_id = customers.id
        `);
        
        // Get invoice items for each invoice
        const invoicesWithItems = await Promise.all(result.rows.map(async invoice => {
            const itemsResult = await db.query(`
                SELECT 
                    invoice_items.*,
                    inventory.name as item_name,
                    inventory.price as item_price
                FROM invoice_items
                JOIN inventory ON invoice_items.item_id = inventory.id
                WHERE invoice_id = $1
            `, [invoice.id]);
            
            return {
                ...invoice,
                items: itemsResult.rows
            };
        }));
        
        res.json(invoicesWithItems);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/invoices', async (req, res) => {
    const { customer_id, date, items, subtotal, tax, total } = req.body;
    
    try {
        // Start transaction
        await db.query('BEGIN');
        
        // Insert invoice
        const invoiceResult = await db.query(
            `INSERT INTO invoices 
             (customer_id, date, subtotal, tax, total, status) 
             VALUES ($1, $2, $3, $4, $5, 'pending') 
             RETURNING *`,
            [customer_id, date, subtotal, tax, total]
        );
        
        const invoice = invoiceResult.rows[0];
        
        // Insert invoice items and update inventory
        for (const item of items) {
            await db.query(
                `INSERT INTO invoice_items 
                 (invoice_id, item_id, quantity, price) 
                 VALUES ($1, $2, $3, $4)`,
                [invoice.id, item.item_id, item.quantity, item.price]
            );
            
            // Update inventory stock
            await db.query(
                'UPDATE inventory SET stock = stock - $1 WHERE id = $2',
                [item.quantity, item.item_id]
            );
        }
        
        // Commit transaction
        await db.query('COMMIT');
        
        res.status(201).json(invoice);
    } catch (err) {
        // Rollback transaction on error
        await db.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/dashboard', async (req, res) => {
    try {
        const [revenueResult, pendingResult, customersResult, inventoryResult] = await Promise.all([
            db.query('SELECT COALESCE(SUM(total), 0) as total_revenue FROM invoices'),
            db.query("SELECT COUNT(*) as pending_count FROM invoices WHERE status = 'pending'"),
            db.query('SELECT COUNT(*) as customer_count FROM customers'),
            db.query('SELECT COUNT(*) as inventory_count FROM inventory')
        ]);
        
        const recentInvoices = await db.query(`
            SELECT 
                invoices.*,
                customers.name as customer_name
            FROM invoices
            JOIN customers ON invoices.customer_id = customers.id
            ORDER BY date DESC
            LIMIT 5
        `);
        
        res.json({
            total_revenue: parseFloat(revenueResult.rows[0].total_revenue),
            pending_invoices: parseInt(pendingResult.rows[0].pending_count),
            total_customers: parseInt(customersResult.rows[0].customer_count),
            inventory_items: parseInt(inventoryResult.rows[0].inventory_count),
            recent_invoices: recentInvoices.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
