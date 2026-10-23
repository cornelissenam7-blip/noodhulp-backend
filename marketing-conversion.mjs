export const directSales = input => /Conversion goal: direct purchase\./.test(input.fields?.['agent-instructions'] || '');
export const purchaseCtas = ['Bekijk het boek.','Bestel het boek.','Bekijk de producten.','Bestel online.','View the book.','Order the book.','View the products.','Order online.'];
