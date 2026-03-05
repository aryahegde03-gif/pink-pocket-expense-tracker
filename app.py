from flask import Flask, request, jsonify, render_template
import sqlite3
from datetime import datetime
import os

app = Flask(__name__)
DATABASE = 'database.db'


# ─────────────────────────────────────────────
# Database helpers
# ─────────────────────────────────────────────

def get_db():
    """Open a new database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row          # rows behave like dicts
    return conn


def init_db():
    """Create tables if they don't exist yet."""
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS expenses (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                amount      REAL    NOT NULL,
                category    TEXT    NOT NULL,
                description TEXT,
                date        TEXT    NOT NULL,
                created_at  TEXT    DEFAULT (datetime('now'))
            )
        ''')
        conn.commit()


# ─────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────

@app.route('/')
def index():
    """Serve the main HTML page."""
    return render_template('index.html')


# ── CRUD ──────────────────────────────────────

@app.route('/api/expenses', methods=['POST'])
def add_expense():
    """Add a new expense record."""
    data = request.get_json(silent=True) or {}

    amount      = data.get('amount')
    category    = data.get('category', '').strip()
    description = data.get('description', '').strip()
    date        = data.get('date', '').strip()

    # Basic validation
    if amount is None or not category or not date:
        return jsonify({'error': 'amount, category, and date are required'}), 400

    try:
        amount = float(amount)
        if amount <= 0:
            raise ValueError
    except ValueError:
        return jsonify({'error': 'amount must be a positive number'}), 400

    try:
        datetime.strptime(date, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'date must be in YYYY-MM-DD format'}), 400

    with get_db() as conn:
        cursor = conn.execute(
            'INSERT INTO expenses (amount, category, description, date) VALUES (?, ?, ?, ?)',
            (amount, category, description, date)
        )
        conn.commit()
        expense_id = cursor.lastrowid

    return jsonify({
        'message': 'Expense added successfully',
        'id': expense_id
    }), 201


@app.route('/api/expenses', methods=['GET'])
def get_expenses():
    """
    Return all expenses, optionally filtered by:
      ?category=Food
      ?start=2024-01-01&end=2024-01-31
    """
    category   = request.args.get('category')
    start_date = request.args.get('start')
    end_date   = request.args.get('end')

    query  = 'SELECT * FROM expenses WHERE 1=1'
    params = []

    if category:
        query  += ' AND category = ?'
        params.append(category)

    if start_date:
        query  += ' AND date >= ?'
        params.append(start_date)

    if end_date:
        query  += ' AND date <= ?'
        params.append(end_date)

    query += ' ORDER BY date DESC, id DESC'

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    expenses = [dict(row) for row in rows]
    return jsonify(expenses), 200


@app.route('/api/expenses/<int:expense_id>', methods=['GET'])
def get_expense(expense_id):
    """Return a single expense by ID."""
    with get_db() as conn:
        row = conn.execute('SELECT * FROM expenses WHERE id = ?', (expense_id,)).fetchone()

    if row is None:
        return jsonify({'error': 'Expense not found'}), 404

    return jsonify(dict(row)), 200


@app.route('/api/expenses/<int:expense_id>', methods=['PUT'])
def update_expense(expense_id):
    """Update an existing expense."""
    data = request.get_json(silent=True) or {}

    with get_db() as conn:
        existing = conn.execute('SELECT * FROM expenses WHERE id = ?', (expense_id,)).fetchone()
        if existing is None:
            return jsonify({'error': 'Expense not found'}), 404

        amount      = data.get('amount',      existing['amount'])
        category    = data.get('category',    existing['category'])
        description = data.get('description', existing['description'])
        date        = data.get('date',        existing['date'])

        try:
            amount = float(amount)
            if amount <= 0:
                raise ValueError
        except ValueError:
            return jsonify({'error': 'amount must be a positive number'}), 400

        conn.execute(
            'UPDATE expenses SET amount=?, category=?, description=?, date=? WHERE id=?',
            (amount, category, description, date, expense_id)
        )
        conn.commit()

    return jsonify({'message': 'Expense updated successfully'}), 200


@app.route('/api/expenses/<int:expense_id>', methods=['DELETE'])
def delete_expense(expense_id):
    """Delete an expense by ID."""
    with get_db() as conn:
        existing = conn.execute('SELECT id FROM expenses WHERE id = ?', (expense_id,)).fetchone()
        if existing is None:
            return jsonify({'error': 'Expense not found'}), 404

        conn.execute('DELETE FROM expenses WHERE id = ?', (expense_id,))
        conn.commit()

    return jsonify({'message': 'Expense deleted successfully'}), 200


# ── Analytics ─────────────────────────────────

@app.route('/api/summary/monthly', methods=['GET'])
def monthly_summary():
    """
    Return spending totals grouped by month.
    Optional ?year=2024 filter.
    Response shape: [ {month, total, count}, ... ]
    """
    year = request.args.get('year')

    query  = "SELECT strftime('%Y-%m', date) AS month, SUM(amount) AS total, COUNT(*) AS count FROM expenses"
    params = []

    if year:
        query  += " WHERE strftime('%Y', date) = ?"
        params.append(str(year))

    query += " GROUP BY month ORDER BY month"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    return jsonify([dict(row) for row in rows]), 200


@app.route('/api/summary/category', methods=['GET'])
def category_summary():
    """
    Return spending totals grouped by category.
    Optional ?month=2024-03 filter.
    Response shape: [ {category, total, count, percentage}, ... ]
    """
    month = request.args.get('month')       # e.g. "2024-03"

    query  = "SELECT category, SUM(amount) AS total, COUNT(*) AS count FROM expenses"
    params = []

    if month:
        query  += " WHERE strftime('%Y-%m', date) = ?"
        params.append(month)

    query += " GROUP BY category ORDER BY total DESC"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    data        = [dict(row) for row in rows]
    grand_total = sum(r['total'] for r in data) or 1   # avoid /0

    for row in data:
        row['percentage'] = round(row['total'] / grand_total * 100, 2)

    return jsonify(data), 200


@app.route('/api/summary/overview', methods=['GET'])
def overview():
    """
    High-level dashboard numbers:
      - total_spent (all time)
      - total_expenses (record count)
      - average_expense
      - highest_expense
      - current_month_total
      - top_category
    """
    with get_db() as conn:
        stats = conn.execute('''
            SELECT
                COALESCE(SUM(amount), 0)   AS total_spent,
                COUNT(*)                   AS total_expenses,
                COALESCE(AVG(amount), 0)   AS average_expense,
                COALESCE(MAX(amount), 0)   AS highest_expense
            FROM expenses
        ''').fetchone()

        current_month = datetime.now().strftime('%Y-%m')
        month_total = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE strftime('%Y-%m', date) = ?",
            (current_month,)
        ).fetchone()['total']

        top_cat_row = conn.execute(
            "SELECT category, SUM(amount) AS total FROM expenses GROUP BY category ORDER BY total DESC LIMIT 1"
        ).fetchone()

    result = dict(stats)
    result['current_month_total'] = month_total
    result['top_category']        = top_cat_row['category'] if top_cat_row else None
    result['average_expense']     = round(result['average_expense'], 2)

    return jsonify(result), 200


@app.route('/api/categories', methods=['GET'])
def get_categories():
    """Return the distinct categories already in the database."""
    with get_db() as conn:
        rows = conn.execute('SELECT DISTINCT category FROM expenses ORDER BY category').fetchall()

    return jsonify([row['category'] for row in rows]), 200


# ─────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────

if __name__ == '__main__':
    if not os.path.exists(DATABASE):
        init_db()
        print('✅  Database initialised.')
    else:
        init_db()   # safe to re-run; CREATE TABLE IF NOT EXISTS

    app.run(debug=True, port=5000)