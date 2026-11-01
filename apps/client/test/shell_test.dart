import 'package:erp_design/erp_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genui_erp_client/agent/conversation.dart';
import 'package:genui_erp_client/auth/auth.dart';
import 'package:genui_erp_client/catalog/erp_catalog.dart';
import 'package:genui_erp_client/shell/home_screen.dart';

class _SignedIn extends AuthController {
  @override
  AuthState build() => const AuthState(
    session: AuthSession(
      token: 't',
      userName: 'Priya Nair',
      role: 'warehouse',
      tenantName: 'Northfield Textiles',
      currency: 'USD',
    ),
  );
}

final _queue = [
  {
    'version': 'v0.9',
    'createSurface': {'surfaceId': 's1', 'catalogId': erpCatalogId},
  },
  {
    'version': 'v0.9',
    'updateComponents': {
      'surfaceId': 's1',
      'components': [
        {
          'id': 'root',
          'component': 'Panel',
          'title': 'Orders stuck in dispatch',
          'children': ['t'],
        },
        {
          'id': 't',
          'component': 'DataTable',
          'columns': [
            {'key': 'orderNumber', 'label': 'Order', 'type': 'mono'},
            {'key': 'customer', 'label': 'Customer', 'type': 'text'},
          ],
          'rows': [
            {'orderNumber': 'SO-11185', 'customer': 'Moor Menswear'},
          ],
        },
      ],
    },
  },
];

Future<ProviderContainer> pumpShell(WidgetTester tester, double width) async {
  tester.view.physicalSize = Size(width, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final container = ProviderContainer(overrides: [authProvider.overrideWith(_SignedIn.new)]);
  addTearDown(container.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(theme: buildErpTheme(Brightness.light), home: const HomeScreen()),
    ),
  );
  await tester.pumpAndSettle();
  return container;
}

void main() {
  testWidgets('desktop shows the navigation with session history', (tester) async {
    await pumpShell(tester, 1280);
    expect(find.text('This session'), findsOneWidget);
    expect(find.byTooltip('Collapse navigation'), findsOneWidget);
  });

  testWidgets('the navigation collapses to a rail on desktop', (tester) async {
    await pumpShell(tester, 1280);
    await tester.tap(find.byTooltip('Collapse navigation'));
    await tester.pumpAndSettle();
    expect(find.text('This session'), findsNothing);
    expect(find.byTooltip('Expand navigation'), findsOneWidget);
  });

  testWidgets('tablet shows a rail and no session list', (tester) async {
    await pumpShell(tester, 800);
    expect(find.text('This session'), findsNothing);
    expect(find.byTooltip('Northfield Textiles, warehouse'), findsOneWidget);
  });

  testWidgets('phone shows a top bar and keeps the ask box at the bottom', (tester) async {
    await pumpShell(tester, 390);
    expect(find.text('Priya Nair, warehouse'), findsOneWidget);
    final askBox = tester.getRect(find.byType(TextField));
    expect(askBox.bottom, greaterThan(800));
  });

  testWidgets('Ctrl+K focuses the ask box', (tester) async {
    await pumpShell(tester, 1280);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pump();
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'ask box');
  });

  testWidgets('opening a row shows the record panel and Esc closes it', (tester) async {
    final container = await pumpShell(tester, 1280);
    container.read(conversationProvider.notifier).debugShow('which orders are stuck?', _queue);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Moor Menswear'));
    await tester.pumpAndSettle();
    expect(find.text('Open full order'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('Open full order'), findsNothing);
  });

  testWidgets('arrow keys move the focused row and Enter opens it', (tester) async {
    final container = await pumpShell(tester, 1280);
    container.read(conversationProvider.notifier).debugShow('which orders are stuck?', _queue);
    await tester.pumpAndSettle();
    final table = find.byType(DataTableView);
    Focus.of(tester.element(find.descendant(of: table, matching: find.text('SO-11185')))).requestFocus();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('Open full order'), findsOneWidget);
  });
}
