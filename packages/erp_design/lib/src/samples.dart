import 'catalog/generated.dart' as g;

/// Sample data for the gallery and golden tests. Shapes match what the server
/// sends after it resolves bindings.
abstract final class Samples {
  static const _source = {
    'tables': ['sales_orders', 'sales_order_lines', 'customers'],
    'filters': {'from': '2026-01-01', 'to': '2026-06-30', 'excludes': 'cancelled orders'},
    'at': '2026-06-30T12:00:00.000Z',
  };

  static final panel = g.Panel.fromJson({
    'title': 'Sales, January to June',
    'subtitle': 'Northfield Textiles, all customers',
    'children': ['kpis', 'trend'],
    'source': [_source],
    'followUps': ['Which customers grew the most?', 'Show margin by category', 'Compare with last year'],
  });

  static final kpis = g.KpiStrip.fromJson({
    'items': [
      {'label': 'Revenue', 'value': 114267298, 'previous': 98012211, 'format': 'money'},
      {'label': 'Orders', 'value': 1256, 'previous': 1301, 'format': 'number'},
      {'label': 'Average order', 'value': 405594, 'previous': 376323, 'format': 'money'},
    ],
  });

  static final trend = g.TrendChart.fromJson({
    'title': 'Revenue by month',
    'kind': 'line',
    'xField': 'label',
    'series': [
      {'field': 'revenueCents', 'label': 'Revenue', 'format': 'money'},
    ],
    'rows': [
      {'label': 'Jan 2026', 'revenueCents': 61200000},
      {'label': 'Feb 2026', 'revenueCents': 52310000},
      {'label': 'Mar 2026', 'revenueCents': 70420000},
      {'label': 'Apr 2026', 'revenueCents': 74259306},
      {'label': 'May 2026', 'revenueCents': 71417345},
      {'label': 'Jun 2026', 'revenueCents': 67302007},
    ],
  });

  static final bars = g.TrendChart.fromJson({
    'title': 'Orders by week',
    'kind': 'bar',
    'xField': 'label',
    'series': [
      {'field': 'orders', 'label': 'Orders', 'format': 'number'},
    ],
    'rows': [
      for (final (i, n) in [41, 47, 52, 38, 44, 58, 61, 49].indexed) {'label': 'W${i + 18}', 'orders': n},
    ],
  });

  static final table = g.DataTable.fromJson({
    'title': 'Orders waiting to dispatch',
    'columns': [
      {'key': 'orderNumber', 'label': 'Order', 'type': 'mono'},
      {'key': 'customer', 'label': 'Customer', 'type': 'text'},
      {'key': 'status', 'label': 'Status', 'type': 'status'},
      {'key': 'queuedAt', 'label': 'Queued', 'type': 'date', 'sortable': true},
      {'key': 'ageDays', 'label': 'Days waiting', 'type': 'number', 'sortable': true},
      {'key': 'valueCents', 'label': 'Value', 'type': 'money'},
    ],
    'rows': [
      {
        'orderNumber': 'SO-11185',
        'customer': 'Moor Menswear',
        'status': 'packed',
        'queuedAt': '2026-06-19T15:00:00Z',
        'ageDays': 11,
        'valueCents': 1284500,
      },
      {
        'orderNumber': 'SO-11227',
        'customer': 'Skelton Apparel',
        'status': 'picking',
        'queuedAt': '2026-06-22T12:00:00Z',
        'ageDays': 8,
        'valueCents': 96320,
      },
      {
        'orderNumber': 'SO-11234',
        'customer': 'Calder Workwear',
        'status': 'queued',
        'queuedAt': '2026-06-24T09:00:00Z',
        'ageDays': 6,
        'valueCents': 412075,
      },
      {
        'orderNumber': 'SO-11240',
        'customer': 'Holm Fashion House',
        'status': 'packed',
        'queuedAt': '2026-06-24T16:00:00Z',
        'ageDays': 5,
        'valueCents': 2250000,
      },
    ],
    'total': 14,
    'offset': 0,
    'pageSize': 4,
    'sort': {'key': 'ageDays', 'direction': 'desc'},
    'rowActions': [
      {
        'action': 'markDispatched',
        'label': 'Mark dispatched',
        'input': {
          'orderNumber': {'field': 'orderNumber'},
        },
        'ask': [
          {'key': 'carrier', 'label': 'Carrier', 'kind': 'text'},
        ],
      },
    ],
  });

  static final emptyTable = g.DataTable.fromJson({
    'title': 'Overdue invoices',
    'columns': [
      {'key': 'number', 'label': 'Invoice', 'type': 'mono'},
      {'key': 'outstandingCents', 'label': 'Outstanding', 'type': 'money'},
    ],
    'rows': <Object>[],
    'emptyText': 'No invoices are overdue. Nothing needs chasing today.',
  });

  static final breakdown = g.BreakdownBar.fromJson({
    'title': 'Top customers by revenue',
    'labelField': 'label',
    'valueField': 'revenueCents',
    'format': 'money',
    'rows': [
      {'label': 'Moor Menswear', 'revenueCents': 18450000},
      {'label': 'Ashby Outfitters', 'revenueCents': 15210000},
      {'label': 'Calder Workwear', 'revenueCents': 12030000},
      {'label': 'Pennine Apparel', 'revenueCents': 9870000},
      {'label': 'Holm Fashion House', 'revenueCents': 6420000},
    ],
  });

  static final record = g.RecordCard.fromJson({
    'title': 'SO-11185',
    'subtitle': 'Moor Menswear, Sheffield',
    'status': 'packed',
    'fields': [
      {'label': 'Ordered', 'value': '2026-06-18T10:00:00Z', 'type': 'date'},
      {'label': 'Required by', 'value': '2026-06-24', 'type': 'date'},
      {'label': 'Warehouse', 'value': 'Manchester North', 'type': 'text'},
      {'label': 'Lines', 'value': 4, 'type': 'number'},
      {'label': 'Total', 'value': 1284500, 'type': 'money'},
      {'label': 'Carrier', 'value': null, 'type': 'text'},
    ],
    'links': [
      {'label': 'Customer ledger', 'question': 'Show the ledger for Moor Menswear'},
      {'label': 'Other open orders', 'question': 'Open orders for Moor Menswear'},
    ],
  });

  static final timeline = g.Timeline.fromJson({
    'title': 'Status history',
    'labelField': 'status',
    'atField': 'at',
    'noteField': 'note',
    'rows': [
      {'status': 'queued', 'at': '2026-06-19T15:00:00Z', 'note': null},
      {'status': 'picking', 'at': '2026-06-20T09:00:00Z', 'note': null},
      {'status': 'packed', 'at': '2026-06-20T17:00:00Z', 'note': 'Carrier missed collection.'},
    ],
  });

  static final approval = g.ApprovalForm.fromJson({
    'requestId': '6f1d3c1e-9a7b-4a52-8d0e-2b1c9e5f7a10',
    'title': 'Raise credit limit for Moor Menswear',
    'requestedBy': 'Tom Ashby',
    'reason': 'Seasonal stock-up order exceeds the current limit.',
    'impact': [
      {'label': 'Current limit', 'value': 1000000, 'type': 'money'},
      {'label': 'Requested limit', 'value': 2000000, 'type': 'money'},
      {'label': 'Balance', 'value': 842310, 'type': 'money'},
    ],
  });

  static final confirm = g.ConfirmAction.fromJson({
    'action': 'markDispatched',
    'input': {'orderNumber': 'SO-11185', 'carrier': 'Pennine Couriers'},
    'idempotencyKey': 'sample-key-0001',
    'title': 'Dispatch SO-11185',
    'summary': 'Marks SO-11185 as dispatched with Pennine Couriers.',
    'changes': [
      {'entity': 'Dispatch', 'label': 'SO-11185', 'field': 'status', 'from': 'packed', 'to': 'dispatched'},
      {'entity': 'Dispatch', 'label': 'SO-11185', 'field': 'carrier', 'from': null, 'to': 'Pennine Couriers'},
      {'entity': 'Order', 'label': 'SO-11185', 'field': 'status', 'from': 'packed', 'to': 'dispatched'},
    ],
  });

  static final filters = g.FilterBar.fromJson({
    'result': 'r1',
    'filters': [
      {'key': 'range', 'label': 'Ordered', 'kind': 'dateRange', 'value': '2026-06-01..2026-06-30'},
      {
        'key': 'status',
        'label': 'Status',
        'kind': 'select',
        'options': ['queued', 'picking', 'packed'],
        'value': null,
      },
      {'key': 'search', 'label': 'Order number', 'kind': 'text', 'value': null},
    ],
  });

  static final notices = [
    for (final (tone, title, body, next) in [
      ('info', 'Showing your customers only', 'Sales figures cover the 20 accounts you own.', null),
      ('success', 'Payment recorded', r'$10.00 was applied to INV-50024.', null),
      (
        'warning',
        'Two products are out of stock',
        'Orders containing them will wait in picking.',
        'Ask which purchase orders will restock them.',
      ),
      (
        'danger',
        'Margins are not available to your role',
        'Cost and margin figures are limited to owners.',
        'Ask about revenue or order volume instead.',
      ),
    ])
      g.Notice.fromJson({'tone': tone, 'title': title, 'body': body, 'nextStep': next}),
  ];
}
