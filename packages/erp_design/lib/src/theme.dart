import 'package:flutter/material.dart';

import 'tokens.dart';

@immutable
final class ErpTheme extends ThemeExtension<ErpTheme> {
  const ErpTheme(this.colors);

  final ErpColors colors;

  ErpType get text => ErpType(colors.text, colors.textSecondary, colors.textMuted);

  @override
  ErpTheme copyWith({ErpColors? colors}) => ErpTheme(colors ?? this.colors);

  @override
  ErpTheme lerp(ErpTheme? other, double t) => t < 0.5 || other == null ? this : other;
}

extension ErpThemeContext on BuildContext {
  ErpTheme get erp => Theme.of(this).extension<ErpTheme>()!;
  ErpColors get colors => erp.colors;
  ErpType get type => erp.text;
}

ThemeData buildErpTheme(Brightness brightness) {
  final c = brightness == Brightness.light ? ErpColors.light : ErpColors.dark;
  final t = ErpType(c.text, c.textSecondary, c.textMuted);
  final controlBorder = OutlineInputBorder(
    borderRadius: Radii.control,
    borderSide: BorderSide(color: c.borderStrong),
  );
  return ThemeData(
    brightness: brightness,
    useMaterial3: true,
    fontFamily: ErpType.sansFamily,
    scaffoldBackgroundColor: c.bg,
    canvasColor: c.bg,
    dividerColor: c.border,
    splashFactory: NoSplash.splashFactory,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: c.accent,
      onPrimary: c.onAccent,
      secondary: c.accent,
      onSecondary: c.onAccent,
      error: c.danger,
      onError: c.surface,
      surface: c.surface,
      onSurface: c.text,
      surfaceContainerHighest: c.surfaceSunken,
      outline: c.borderStrong,
      outlineVariant: c.border,
    ),
    textTheme: TextTheme(
      displaySmall: t.display,
      titleLarge: t.title,
      titleMedium: t.heading,
      bodyMedium: t.body,
      bodySmall: t.caption,
      labelLarge: t.bodyStrong,
    ),
    focusColor: c.accentSubtle,
    hoverColor: c.surfaceSunken,
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: true,
      fillColor: c.surface,
      hintStyle: t.body.copyWith(color: c.textMuted),
      contentPadding: const EdgeInsets.symmetric(horizontal: Space.x3, vertical: Space.x2 + 2),
      border: controlBorder,
      enabledBorder: controlBorder,
      focusedBorder: controlBorder.copyWith(borderSide: BorderSide(color: c.accent, width: 2)),
    ),
    // One shadow is allowed, for overlays only.
    popupMenuTheme: PopupMenuThemeData(
      color: c.surface,
      elevation: 6,
      shadowColor: Colors.black.withValues(alpha: 0.18),
      shape: RoundedRectangleBorder(
        borderRadius: Radii.surface,
        side: BorderSide(color: c.border),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: c.surface,
      elevation: 6,
      shadowColor: Colors.black.withValues(alpha: 0.18),
      shape: RoundedRectangleBorder(
        borderRadius: Radii.surface,
        side: BorderSide(color: c.border),
      ),
    ),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(color: c.text, borderRadius: Radii.control),
      textStyle: t.caption.copyWith(color: c.bg),
    ),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
        TargetPlatform.macOS: FadeForwardsPageTransitionsBuilder(),
      },
    ),
    extensions: [ErpTheme(c)],
  );
}
