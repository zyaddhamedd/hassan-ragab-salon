import os
import time
from collections import defaultdict
from flask import Blueprint, request, jsonify, g
from sqlalchemy import event
from sqlalchemy.engine import Engine

performance_bp = Blueprint('performance', __name__)

PERFORMANCE_MODE = os.environ.get('PERFORMANCE_MODE', 'False').lower() == 'true'

# In-memory storage for metrics
metrics = {
    'total_requests': 0,
    'total_response_time_ms': 0,
    'total_queries': 0,
    'endpoints': defaultdict(int),
    'slow_endpoints': [],  # list of dicts: {'endpoint': ..., 'time_ms': ...}
    'slow_queries': [],    # list of dicts: {'query': ..., 'time_ms': ...}
}

def init_performance_monitoring(app):
    if not PERFORMANCE_MODE:
        return

    print("🚀 Performance Mode is ENABLED")
    
    # Register the reporting endpoint
    app.register_blueprint(performance_bp)

    @app.before_request
    def before_request():
        g.start_time = time.time()
        g.query_count = 0

    @app.after_request
    def after_request(response):
        if hasattr(g, 'start_time'):
            elapsed_ms = (time.time() - g.start_time) * 1000
            endpoint = f"{request.method} {request.path}"
            
            metrics['total_requests'] += 1
            metrics['total_response_time_ms'] += elapsed_ms
            metrics['endpoints'][endpoint] += 1
            
            # Use getattr with default to safely retrieve query_count
            query_count = getattr(g, 'query_count', 0)
            metrics['total_queries'] += query_count

            if elapsed_ms > 300:
                print(f"[SLOW_ENDPOINT] {endpoint} took {elapsed_ms:.2f}ms with {query_count} queries")
                metrics['slow_endpoints'].append({'endpoint': endpoint, 'time_ms': elapsed_ms})
                # Keep only top 10
                metrics['slow_endpoints'] = sorted(metrics['slow_endpoints'], key=lambda x: x['time_ms'], reverse=True)[:10]

        return response

    # SQLAlchemy event listeners natively injected onto the engine
    @event.listens_for(Engine, "before_cursor_execute")
    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        context._query_start_time = time.time()

    @event.listens_for(Engine, "after_cursor_execute")
    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        try:
            if hasattr(g, 'query_count'):
                g.query_count += 1
                
            elapsed_ms = (time.time() - getattr(context, '_query_start_time', time.time())) * 1000
            if elapsed_ms > 50:
                print(f"[SLOW_QUERY] {elapsed_ms:.2f}ms: {statement[:200]}...")
                metrics['slow_queries'].append({'query': statement, 'time_ms': elapsed_ms})
                # Keep only top 10
                metrics['slow_queries'] = sorted(metrics['slow_queries'], key=lambda x: x['time_ms'], reverse=True)[:10]
        except RuntimeError:
             # Occurs if executed outside an active Flask request context
             pass

@performance_bp.route('/performance-report', methods=['GET'])
def get_report():
    if not PERFORMANCE_MODE:
        return jsonify({"error": "Performance mode is disabled"}), 403

    avg_resp_time = 0
    if metrics['total_requests'] > 0:
        avg_resp_time = metrics['total_response_time_ms'] / metrics['total_requests']
        
    avg_queries = 0
    if metrics['total_requests'] > 0:
        avg_queries = metrics['total_queries'] / metrics['total_requests']

    top_endpoints = sorted(metrics['endpoints'].items(), key=lambda x: x[1], reverse=True)[:10]

    return jsonify({
        'average_response_time': round(avg_resp_time, 2),
        'total_requests_count': metrics['total_requests'],
        'average_queries_per_request': round(avg_queries, 2),
        'most_called_endpoints': [{'endpoint': k, 'calls': v} for k, v in top_endpoints],
        'slowest_endpoints': metrics['slow_endpoints'],
        'slowest_queries': metrics['slow_queries']
    })
