import 'package:erp_design/erp_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const widths = {'phone': 390.0, 'desktop': 1280.0};

Future<void> pumpComponent(WidgetTester tester, Brightness b, double width, Widget child) async {
  tester.view.physicalSize = Size(width, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: buildErpTheme(b),
    home: Scaffold(
      body: Align(
        alignment: Alignment.topLeft,
        child: RepaintBoundary(
          key: const ValueKey('golden'),
          child: Container(
            width: width,
            color: b == Brightness.light ? ErpColors.light.bg : ErpColors.dark.bg,
            padding: const EdgeInsets.all(Space.x4),
            child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: Breakpoints.column), child: child),
          ),
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  for (final name in CatalogGallery.names) {
    for (final b in Brightness.values) {
      for (final MapEntry(key: size, value: width) in widths.entries) {
        testWidgets('$name ${b.name} $size', (tester) async {
          await pumpComponent(tester, b, width, CatalogGallery(only: name));
          await expectLater(find.byKey(const ValueKey('golden')), matchesGoldenFile('goldens/${name}_${b.name}_$size.png'));
        });
      }
    }
  }

  for (final name in ['KpiStrip', 'DataTable', 'TrendChart', 'RecordCard']) {
    for (final b in Brightness.values) {
      testWidgets('$name skeleton ${b.name}', (tester) async {
        await pumpComponent(tester, b, 1280, CatalogGallery(only: name, skeletons: true));
        await expectLater(find.byKey(const ValueKey('golden')), matchesGoldenFile('goldens/${name}_skeleton_${b.name}.png'));
      });
    }
  }
}
