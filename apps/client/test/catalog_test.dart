import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:erp_design/erp_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genui/genui.dart';
import 'package:genui_erp_client/catalog/erp_catalog.dart';
import 'package:genui_erp_client/catalog/erp_scope.dart';

Map<String, Object?> table({int offset = 0}) => {
  'id': 't',
  'component': 'DataTable',
  'title': 'Orders',
  'columns': [
    {'key': 'number', 'label': 'Order', 'type': 'mono', 'sortable': false},
    {'key': 'valueCents', 'label': 'Value', 'type': 'money', 'sortable': false},
  ],
  'rows': [
    {'number': 'SO-10001', 'valueCents': 123456},
    {'number': 'SO-10002', 'valueCents': 990},
  ],
  'total': 40,
  'offset': offset,
  'pageSize': 2,
};

void main() {
  _registerMore();

  testWidgets('renders server components through genui and sends paging back as an event', (tester) async {
    final controller = SurfaceController(catalogs: [buildErpCatalog()]);
    addTearDown(controller.dispose);
    final submitted = <ChatMessage>[];
    final sub = controller.onSubmit.listen(submitted.add);
    addTearDown(sub.cancel);

    controller.handleMessage(
      core.A2uiMessage.fromJson({
        'version': 'v0.9',
        'createSurface': {'surfaceId': 's1', 'catalogId': erpCatalogId},
      }),
    );
    controller.handleMessage(
      core.A2uiMessage.fromJson({
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 's1',
          'components': [
            {
              'id': 'root',
              'component': 'Panel',
              'title': 'Recent orders',
              'children': ['t'],
              'followUps': ['Which orders are stuck?'],
            },
            table(),
          ],
        },
      }),
    );

    final asked = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: buildErpTheme(Brightness.light),
        home: Scaffold(
          body: ErpScope(
            ask: asked.add,
            openRow: (_) {},
            child: SingleChildScrollView(
              child: SizedBox(width: 900, child: Surface(surfaceContext: controller.contextFor('s1'))),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Recent orders'), findsOneWidget);
    expect(find.text('SO-10001'), findsOneWidget);
    expect(find.text(r'$1,234.56'), findsOneWidget);
    expect(find.text('1–2 of 40'), findsOneWidget);

    await tester.tap(find.text('Next'));
    await tester.pump();
    final interaction =
        jsonDecode(submitted.single.parts.single.asUiInteractionPart!.interaction) as Map<String, Object?>;
    expect(interaction['action'], containsPair('name', 'table.page'));
    expect((interaction['action']! as Map)['context'], {'offset': 2});
    expect((interaction['action']! as Map)['surfaceId'], 's1');

    await tester.tap(find.text('Which orders are stuck?'));
    expect(asked, ['Which orders are stuck?']);
  });
}

Future<List<Map<String, Object?>>> pumpSurface(WidgetTester tester, List<Map<String, Object?>> components) async {
  final controller = SurfaceController(catalogs: [buildErpCatalog()]);
  addTearDown(controller.dispose);
  final events = <Map<String, Object?>>[];
  final sub = controller.onSubmit.listen(
    (m) => events.add(
      (jsonDecode(m.parts.single.asUiInteractionPart!.interaction) as Map<String, Object?>)['action']!
          as Map<String, Object?>,
    ),
  );
  addTearDown(sub.cancel);
  controller.handleMessage(
    core.A2uiMessage.fromJson({
      'version': 'v0.9',
      'createSurface': {'surfaceId': 'c1', 'catalogId': erpCatalogId},
    }),
  );
  controller.handleMessage(
    core.A2uiMessage.fromJson({
      'version': 'v0.9',
      'updateComponents': {'surfaceId': 'c1', 'components': components},
    }),
  );
  await tester.pumpWidget(
    MaterialApp(
      theme: buildErpTheme(Brightness.light),
      home: Scaffold(
        body: ErpScope(
          ask: (_) {},
          openRow: (_) {},
          child: SingleChildScrollView(
            child: SizedBox(width: 900, child: Surface(surfaceContext: controller.contextFor('c1'))),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return events;
}

final confirmComponents = [
  {
    'id': 'root',
    'component': 'Panel',
    'title': 'Confirm the change',
    'children': ['c'],
  },
  {
    'id': 'c',
    'component': 'ConfirmAction',
    'action': 'markDispatched',
    'input': {'orderNumber': 'SO-1', 'carrier': 'X'},
    'idempotencyKey': 'key-123456789',
    'title': 'Dispatch SO-1',
    'summary': 'Marks SO-1 as dispatched.',
    'changes': [
      {'entity': 'Order', 'label': 'SO-1', 'field': 'status', 'from': 'packed', 'to': 'dispatched'},
    ],
  },
];

void _registerMore() {
  testWidgets('confirm sends only the idempotency key', (tester) async {
    final events = await pumpSurface(tester, confirmComponents);
    await tester.tap(find.text('Confirm'));
    await tester.pump();
    expect(events.single['name'], 'action.confirm');
    expect(events.single['context'], {'idempotencyKey': 'key-123456789'});
  });

  testWidgets('cancel sends a cancel event and nothing else', (tester) async {
    final events = await pumpSurface(tester, confirmComponents);
    await tester.tap(find.text('Cancel'));
    await tester.pump();
    expect(events.map((e) => e['name']), ['action.cancel']);
  });

  testWidgets('an approval needs a reason before it can be sent for preview', (tester) async {
    final events = await pumpSurface(tester, [
      {
        'id': 'root',
        'component': 'Panel',
        'title': 'Pending',
        'children': ['f'],
      },
      {
        'id': 'f',
        'component': 'ApprovalForm',
        'requestId': 'req-1',
        'title': 'Approve discount',
        'requestedBy': 'Tom Ashby',
        'reason': 'Volume order',
        'impact': <Object>[],
      },
    ]);
    await tester.tap(find.text('Approve'));
    await tester.pump();
    expect(events, isEmpty);
    await tester.enterText(find.byType(TextField), 'Fine this season');
    await tester.pump();
    await tester.tap(find.text('Approve'));
    await tester.pump();
    expect(events.single['name'], 'action.preview');
    expect(events.single['context'], {
      'action': 'decideApproval',
      'input': {'requestId': 'req-1', 'decision': 'approve', 'reason': 'Fine this season'},
    });
  });
}
