import { StatusBar } from "expo-status-bar";
import { Button, StyleSheet, View } from "react-native";

export default function App() {
  const handlePress = () => {
    console.log("Hello World!");
  };

  return (
    <View style={styles.container}>
      <Button title="Press Me" onPress={handlePress} />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center", // centers vertically
    alignItems: "center",     // centers horizontally
  },
});