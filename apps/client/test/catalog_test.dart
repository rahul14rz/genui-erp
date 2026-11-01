import 'dart:async';
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
  testWidgets('renders server components through genui and sends paging back as an event', (tester) async {
    final controller = SurfaceController(catalogs: [buildErpCatalog()]);
    addTearDown(controller.dispose);
    final submitted = <ChatMessage>[];
    final sub = controller.onSubmit.listen(submitted.add);
    addTearDown(sub.cancel);

    controller.handleMessage(core.A2uiMessage.fromJson({'version': 'v0.9', 'createSurface': {'surfaceId': 's1', 'catalogId': erpCatalogId}}));
    controller.handleMessage(core.A2uiMessage.fromJson({
      'version': 'v0.9',
      'updateComponents': {
        'surfaceId': 's1',
        'components': [
          {'id': 'root', 'component': 'Panel', 'title': 'Recent orders', 'children': ['t'], 'followUps': ['Which orders are stuck?']},
          table(),
        ],
      },
    }));

    final asked = <String>[];
    await tester.pumpWidget(MaterialApp(
      theme: buildErpTheme(Brightness.light),
      home: Scaffold(
        body: ErpScope(
          ask: asked.add,
          openRow: (_) {},
          child: SingleChildScrollView(child: SizedBox(width: 900, child: Surface(surfaceContext: controller.contextFor('s1')))),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Recent orders'), findsOneWidget);
    expect(find.text('SO-10001'), findsOneWidget);
    expect(find.text(r'$1,234.56'), findsOneWidget);
    expect(find.text('1–2 of 40'), findsOneWidget);

    await tester.tap(find.text('Next'));
    await tester.pump();
    final interaction = jsonDecode(submitted.single.parts.single.asUiInteractionPart!.interaction) as Map<String, Object?>;
    expect(interaction['action'], containsPair('name', 'table.page'));
    expect((interaction['action']! as Map)['context'], {'offset': 2});
    expect((interaction['action']! as Map)['surfaceId'], 's1');

    await tester.tap(find.text('Which orders are stuck?'));
    expect(asked, ['Which orders are stuck?']);
  });
}
